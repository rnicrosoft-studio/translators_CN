{
	"translatorID": "27aeafae-3e7c-4ba1-ba93-04727a2922c5",
	"label": "PKULaw",
	"creator": "Zeping Lee",
	"target": "^https?://www\\.pkulaw\\.com/",
	"minVersion": "3.0",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2024-01-04 14:35:15"
}

/*
	***** BEGIN LICENSE BLOCK *****

	Copyright © 2022 Zeping Lee

	This file is part of Zotero.

	Zotero is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	Zotero is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with Zotero. If not, see <http://www.gnu.org/licenses/>.

	***** END LICENSE BLOCK *****
*/

function detectWeb(doc, url) {
	if (/\/\w+\/\w+/.test(url)) {
		let curMenu = attr(doc, '#curMenu', 'value');
		let dbId = attr(doc, '#DbId', 'value');
		if (curMenu == 'law') {
			if (dbId == 'protocol') {
				return 'report';
			}
			return 'statute';
		}
		else if (curMenu == 'english' && dbId == 'en_law') {
			return 'statute';
		}
		else if (curMenu == 'case') {
			return 'case';
		}
		else if (curMenu == 'journal') return 'journalArticle';
	}
	else if (getSearchResults(doc, true)) {
		return 'multiple';
	}
	return false;
}

function getSearchResults(doc, checkOnly) {
	var items = {};
	var found = false;
	var rows = doc.querySelectorAll('.item h4 > a');
	for (let row of rows) {
		let href = row.href;
		let title = ZU.trimInternal(row.textContent);
		if (!href || !title) continue;
		if (checkOnly) return true;
		found = true;
		items[href] = title;
	}
	return found ? items : false;
}

async function doWeb(doc, url) {
	if (detectWeb(doc, url) == 'multiple') {
		let items = await Zotero.selectItems(getSearchResults(doc, false));
		if (!items) return;
		for (let url of Object.keys(items)) {
			await scrape(await requestDocument(url));
		}
	}
	else {
		await scrape(doc, url);
	}
}

async function scrape(doc, url = doc.location.href) {
	var newItem = new Z.Item(detectWeb(doc, url));
	newItem.extra = '';
	const labels = new Labels(doc, '.fields li > .box');
	Z.debug(labels.innerData.map(arr => [arr[0], ZU.trimInternal(arr[1].innerText)]));
	// Zotero 要求用于 CSL 的额外字段信息填在 `Extra` 的最前面，所以分开存储
	let extraFields = {};
	let extraContents = {};
	let matches = text(doc, '.info').match(/[[【](.+)[】\]]\s*([0-9A-Z.()]+)/);
	extraContents[matches[1]] = matches[2];
	const dbId = attr(doc, '#DbId', 'value');
	Z.debug(dbId);
	extraFields.Type = {
		lar: 'regulation',
		eagn: 'treaty'
	}[dbId];
	let title = pureText(doc.querySelector('h2.title'));
	if (attr(doc, '#curMenu', 'value') == 'english') {
		newItem.language = 'en-US';
		extraFields['original-title'] = text(doc, 'a > h2.title').replace(/\(/g, '（').replace(/\)/g, '）');
	}
	else {
		newItem.language = 'zh-CN';
		let matched = title.match(/(.*)\((.*)\)$/);
		if (matched) {
			let edition = matched[2];
			if (edition.match(/^\d+/)) {
				title = matched[1];
				// 中华人民共和国公司法(2005修订)
				extraFields.Edition = edition.replace(/^(\d+)年?\s*(.*)/, '$1年$2');
			}
		}
		if (extraFields.Type != 'treaty') {
			newItem.shortTitle = title.replace(/^中华人民共和国/, '').replace(/\(/g, '（').replace(/\)/g, '）');
		}
		title = title.replace(/\(/g, '（').replace(/\)/g, '）');
	}
	newItem.libraryCatalog = '北大法宝';
	newItem.url = url.replace(/[?#].*/, '');
	switch (newItem.itemType) {
		case 'statute': {
			newItem.nameOfAct = title;
			// newItem.code = 法典;
			// newItem.codeNumber = 法典编号;
			newItem.publicLawNumber = labels.getWith(['发文字号', 'DocumentNumber']);
			// “签订日期”见于外交领域
			newItem.dateEnacted = labels.getWith(['颁布日期', '公布日期', '发布日期', '签订日期']).replace(/\./g, '-')
				|| ZU.strToISO(labels.getWith('Date Issued'));
			// newItem.pages = 页码;
			// newItem.section = 条文序号;
			// newItem.history = 历史;
			if (labels.getWith('时效性') == '失效') {
				extraFields.Status = '已废止';
			}
			let rank = labels.getWith(['效力位阶', 'LevelofAuthority']);
			if (!/(法律)|(Law)/i.test(rank)) {
				extraFields.Type = extraFields.Type || 'regulation';
			}
			else if (['有关法律问题和重大问题的决定', '党内法规制度'].includes(rank)) {
				newItem.session = tryMatch(text(doc, '#divFullText'), /(中国共产党)?第.*?届.*?第.*?次.*?会议/);
			}
			labels.getWith(['制定机关', '发布部门', 'IssuingAuthority'], true)
				.querySelectorAll('a:first-child')
				.forEach(element => newItem.creators.push(processName(element.textContent))
				);
			break;
		}
		case 'report':
			newItem.title = title;
			newItem.date = labels.getWith('公布日期').replace(/\./g, '-');
			labels.getWith(['制定机关', '发布部门', 'IssuingAuthority'], true).querySelectorAll('a:first-child').forEach(element => newItem.creators.push(processName(element.textContent))
			);
			extraFields['event-title'] = tryMatch(text(doc, '#divFullText'), /第.*?届.*?第.*?次.*?会议/);
			break;
		case 'case': {
			if (title.startsWith('指导案例')) {
				title = title.replace(/.*?：/, '');
				extraFields.Series = '最高人民法院指导案例';
				extraFields['Series Number'] = tryMatch(labels.getWith('案例编号'), /(\d+)/, 1);
			}
			newItem.caseName = title;
			newItem.court = labels.getWith(['裁决机构', '审理法院']);
			newItem.dateDecided = labels.getWith(['裁决日期', '审结日期']).replace(/\./g, '-');
			newItem.docketNumber = labels.getWith('案号').replace(/\(/g, '（').replace(/\)/g, '）');
			let source = labels.getWith('来源');
			newItem.reporter = tryMatch(source, /《(.+)》/, 1);
			// "reporterVolume": "报告系统卷次";
			// "firstPage": "起始页";
			// "history": "历史";
			extraFields['available-date'] = labels.getWith('发布日期').replace(/\./g, '-') || tryMatch(source, /(\d+)\s*年/, 1);
			extraFields.Issue = tryMatch(source, /年第\s*(\d+)\s*期/, 1);
			extraFields.Genre = labels.getWith('文书类型');
			let caseType = ['民事', '刑事', '行政'].find(type => labels.getWith('案由').startsWith(type));
			if (caseType) {
				extraFields.Genre = caseType + extraFields.Genre;
			}
			else if (!title.endsWith('裁决书')) {
				extraFields.Genre = '民事判决书';
			}
			labels.getWith('发布部门', true).querySelectorAll('span').forEach(element => newItem.creators.push(processName(element.textContent))
			);
			labels.getWith('权责关键词', true).querySelectorAll('a').forEach(element => newItem.tags.push(element.textContent));
			break;
		}
		case 'journalArticle':
			newItem.title = title;
			newItem.abstractNote = [labels.getWith('摘要'), labels.getWith('英文摘要')].join('\n');
			newItem.publicationTitle = tryMatch(labels.getWith('期刊名称'), /《(.+)》/, 1);
			newItem.issue = labels.getWith('期号');
			newItem.pages = labels.getWith('页码');
			newItem.date = labels.getWith('期刊年份');
			labels.getWith('作者', true).querySelectorAll('a').forEach(element => newItem.creators.push(processName(element.textContent))
			);
			labels.getWith('关键词', true).querySelectorAll('a').forEach(element => newItem.tags.push(element.textContent)
			);
			break;
		default:
			break;
	}
	extraFields = Object.assign(extraFields, extraContents);
	newItem.extra = Object.entries(extraFields)
		.filter(entry => entry[1])
		.map(entry => `${entry[0]}: ${entry[1]}`)
		.join('\n');
	newItem.attachments.push({
		title: 'Snapshot',
		document: doc
	});
	newItem.complete();
}

class Labels {
	constructor(doc, selector) {
		this.innerData = [];
		Array.from(doc.querySelectorAll(selector))
			.filter(element => element.firstElementChild)
			.filter(element => !element.querySelector(selector))
			.filter(element => !/^\s*$/.test(element.textContent))
			.forEach((element) => {
				let elementCopy = element.cloneNode(true);
				let key = elementCopy.removeChild(elementCopy.firstElementChild).innerText.replace(/\s/g, '');
				this.innerData.push([key, elementCopy]);
			});
	}

	getWith(label, element = false) {
		if (Array.isArray(label)) {
			let result = label
				.map(aLabel => this.getWith(aLabel, element));
			result = element
				? result.find(element => element.childNodes.length)
				: result.find(element => element);
			return result
				? result
				: element
					? document.createElement('div')
					: '';
		}
		let pattern = new RegExp(label);
		let keyValPair = this.innerData.find(element => pattern.test(element[0]));
		if (element) return keyValPair ? keyValPair[1] : document.createElement('div');
		return keyValPair
			? ZU.trimInternal(keyValPair[1].innerText)
			: '';
	}
}

function pureText(element) {
	if (!element) return '';
	// Deep copy to avoid affecting the original page.
	let elementCopy = element.cloneNode(true);
	while (elementCopy.lastElementChild) {
		elementCopy.removeChild(elementCopy.lastElementChild);
	}
	return ZU.trimInternal(elementCopy.innerText);
}

function processName(creator, creatorType = 'author') {
	return {
		firstName: '',
		lastName: creator,
		creatorType: creatorType,
		fieldMode: 1
	};
}

function tryMatch(string, pattern, index = 0) {
	let match = string.match(pattern);
	if (match && match[index]) {
		return match[index];
	}
	return '';
}

/** BEGIN TEST CASES **/
var testCases = [
	{
		"type": "web",
		"url": "https://www.pkulaw.com/chl/3ae7651e2659029abdfb.html",
		"items": [
			{
				"itemType": "statute",
				"nameOfAct": "中华人民共和国刑法修正案（十）",
				"creators": [
					{
						"firstName": "",
						"lastName": "全国人大常委会",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"dateEnacted": "2017-11-04",
				"extra": "法宝引证码: CLI.1.304263",
				"language": "zh-CN",
				"publicLawNumber": "中华人民共和国主席令第80号",
				"shortTitle": "刑法修正案（十）",
				"url": "https://www.pkulaw.com/chl/3ae7651e2659029abdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/chl/e54c465cca59c137bdfb.html",
		"items": [
			{
				"itemType": "statute",
				"nameOfAct": "中华人民共和国公司法",
				"creators": [
					{
						"firstName": "",
						"lastName": "全国人大常委会",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"dateEnacted": "2005-10-27",
				"extra": "Edition: 2005年修订\n法宝引证码: CLI.1.60597",
				"language": "zh-CN",
				"publicLawNumber": "中华人民共和国主席令第42号",
				"shortTitle": "公司法",
				"url": "https://www.pkulaw.com/chl/e54c465cca59c137bdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/chl/98ef6bfbd5f5ecdebdfb.html",
		"items": [
			{
				"itemType": "statute",
				"nameOfAct": "最高人民法院、最高人民检察院关于依法严惩破坏计划生育犯罪活动的通知",
				"creators": [
					{
						"firstName": "",
						"lastName": "最高人民法院",
						"creatorType": "author",
						"fieldMode": 1
					},
					{
						"firstName": "",
						"lastName": "最高人民检察院",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"dateEnacted": "1993-11-12",
				"extra": "Type: regulation\nStatus: 已废止\n法宝引证码: CLI.3.8815",
				"language": "zh-CN",
				"publicLawNumber": "法发〔1993〕36号",
				"url": "https://www.pkulaw.com/chl/98ef6bfbd5f5ecdebdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/chl/7d823d434f747555bdfb.html",
		"items": [
			{
				"itemType": "statute",
				"nameOfAct": "全国人民代表大会常务委员会关于严禁卖淫嫖娼的决定",
				"creators": [
					{
						"firstName": "",
						"lastName": "全国人大常委会",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"dateEnacted": "1991-09-04",
				"extra": "法宝引证码: CLI.1.5373",
				"language": "zh-CN",
				"publicLawNumber": "中华人民共和国主席令第51号",
				"session": "第七届全国人民代表大会常务委员会第二十一次会议",
				"url": "https://www.pkulaw.com/chl/7d823d434f747555bdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/chl/dc46bb66e13150b8bdfb.html",
		"items": [
			{
				"itemType": "statute",
				"nameOfAct": "国务院关于在全国建立农村最低生活保障制度的通知",
				"creators": [
					{
						"firstName": "",
						"lastName": "国务院",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"dateEnacted": "2007-07-11",
				"extra": "Type: regulation\n法宝引证码: CLI.2.96270",
				"language": "zh-CN",
				"publicLawNumber": "国发〔2007〕19号",
				"url": "https://www.pkulaw.com/chl/dc46bb66e13150b8bdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/chl/0a15442a31eb74f6bdfb.html",
		"items": [
			{
				"itemType": "statute",
				"nameOfAct": "最高人民法院关于适用《中华人民共和国行政诉讼法》的解释",
				"creators": [
					{
						"firstName": "",
						"lastName": "最高人民法院",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"dateEnacted": "2018-02-06",
				"extra": "Type: regulation\n法宝引证码: CLI.3.309904",
				"language": "zh-CN",
				"publicLawNumber": "法释〔2018〕1号",
				"url": "https://www.pkulaw.com/chl/0a15442a31eb74f6bdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/chl/4a14adc2c14e5e68bdfb.html",
		"items": [
			{
				"itemType": "statute",
				"nameOfAct": "国务院关于印发打赢蓝天保卫战三年行动计划的通知",
				"creators": [
					{
						"firstName": "",
						"lastName": "国务院",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"dateEnacted": "2018-06-27",
				"extra": "Type: regulation\n法宝引证码: CLI.2.316828",
				"language": "zh-CN",
				"publicLawNumber": "国发〔2018〕22号",
				"url": "https://www.pkulaw.com/chl/4a14adc2c14e5e68bdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/lar/c74c0e82aa441b08e9ca1ea4cf401f45bdfb.html",
		"items": [
			{
				"itemType": "statute",
				"nameOfAct": "山东省高温天气劳动保护办法",
				"creators": [
					{
						"firstName": "",
						"lastName": "山东省人民政府",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"dateEnacted": "2011-07-28",
				"extra": "Type: regulation\n法宝引证码: CLI.11.518085",
				"language": "zh-CN",
				"publicLawNumber": "山东省人民政府令第239号",
				"url": "https://www.pkulaw.com/lar/c74c0e82aa441b08e9ca1ea4cf401f45bdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/lar/03e98798ef205f4a1faf9c788c472e25bdfb.html",
		"items": [
			{
				"itemType": "statute",
				"nameOfAct": "德阳市人民政府办公室关于印发《德阳市数据要素市场管理暂行办法》的通知",
				"creators": [
					{
						"firstName": "",
						"lastName": "德阳市人民政府",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"dateEnacted": "2022-09-01",
				"extra": "Type: regulation\n法宝引证码: CLI.12.5537956",
				"language": "zh-CN",
				"publicLawNumber": "德办规[2022]10号",
				"url": "https://www.pkulaw.com/lar/03e98798ef205f4a1faf9c788c472e25bdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/chl/8e624467ca77636dbdfb.html",
		"items": [
			{
				"itemType": "statute",
				"nameOfAct": "中共中央关于全面推进依法治国若干重大问题的决定",
				"creators": [
					{
						"firstName": "",
						"lastName": "中国共产党中央委员会",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"dateEnacted": "2014-10-23",
				"extra": "Type: regulation\n法宝引证码: CLI.16.237344",
				"language": "zh-CN",
				"session": "中国共产党第十八届中央委员会第四次全体会议",
				"url": "https://www.pkulaw.com/chl/8e624467ca77636dbdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/eagn/8e43a3c4e94eed58d5f18c2194e7b611bdfb.html",
		"items": [
			{
				"itemType": "statute",
				"nameOfAct": "中华人民共和国与美利坚合众国联合声明",
				"creators": [],
				"dateEnacted": "2011-01-19",
				"extra": "Type: treaty\n法宝引证码: CLI.T.6998",
				"language": "zh-CN",
				"url": "https://www.pkulaw.com/eagn/8e43a3c4e94eed58d5f18c2194e7b611bdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/protocol/e0c81a0878b582cddca4c85351d16972bdfb.html",
		"items": [
			{
				"itemType": "report",
				"title": "关于《中华人民共和国行政诉讼法修正案（草案）》的说明",
				"creators": [
					{
						"firstName": "",
						"lastName": "全国人大常委会法制工作委员会",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"date": "2013-12-23",
				"extra": "Edition: 2013年\nevent-title: 第十二届全国人民代表大会常务委员会第六次会议\n法宝引证码: CLI.DL.6311",
				"language": "zh-CN",
				"libraryCatalog": "北大法宝",
				"url": "https://www.pkulaw.com/protocol/e0c81a0878b582cddca4c85351d16972bdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/en_law/1fc5de53e239e30bbdfb.html",
		"items": [
			{
				"itemType": "statute",
				"nameOfAct": "Individual Income Tax Law of the People's Republic of China (2011 Amendment)",
				"creators": [
					{
						"firstName": "",
						"lastName": "Standing Committee of the National People's Congress",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"extra": "original-title: 中华人民共和国个人所得税法（2011修正）\nCLI Code: CLI.1.153700(EN)",
				"language": "en-US",
				"publicLawNumber": "Order No.48 of the President of the People's Republic of China",
				"url": "https://www.pkulaw.com/en_law/1fc5de53e239e30bbdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/gac/eee05e2473339b35799c78d539298795d5aa7be54a957fa0bdfb.html",
		"items": [
			{
				"itemType": "case",
				"caseName": "荣宝英诉王阳、永诚财产保险股份有限公司江阴支公司机动车交通事故责任纠纷案",
				"creators": [],
				"dateDecided": "2013-06-21",
				"court": "江苏省无锡市中级人民法院",
				"docketNumber": "（2013）锡民终字第497号",
				"extra": "Series: 最高人民法院指导案例\nSeries Number: 24\navailable-date: 2014-01-26\nIssue: 8\nGenre: 民事判决书\n法宝引证码: CLI.C.2125100",
				"language": "zh-CN",
				"reporter": "最高人民法院公报",
				"shortTitle": "指导案例24号：荣宝英诉王阳、永诚财产保险股份有限公司江阴支公司机动车交通事故责任纠纷案",
				"url": "https://www.pkulaw.com/gac/eee05e2473339b35799c78d539298795d5aa7be54a957fa0bdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [
					{
						"tag": "免责事由"
					},
					{
						"tag": "无过错"
					},
					{
						"tag": "证明"
					},
					{
						"tag": "诉讼请求"
					},
					{
						"tag": "过错"
					},
					{
						"tag": "鉴定意见"
					}
				],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/pfnl/a25051f3312b07f383ab74a250eadc412f753fb855fabeadbdfb.html",
		"items": [
			{
				"itemType": "case",
				"caseName": "***诉***政府信息公开答复案",
				"creators": [],
				"dateDecided": "2015-07-06",
				"court": "江苏省南通市中级人民法院",
				"extra": "available-date: 2015\nIssue: 11\nGenre: 行政裁定书\n法宝引证码: CLI.C.7997435",
				"language": "zh-CN",
				"reporter": "最高人民法院公报",
				"url": "https://www.pkulaw.com/pfnl/a25051f3312b07f383ab74a250eadc412f753fb855fabeadbdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [
					{
						"tag": "关联性"
					},
					{
						"tag": "合法"
					},
					{
						"tag": "复议机关"
					},
					{
						"tag": "拘留"
					},
					{
						"tag": "政府信息公开"
					},
					{
						"tag": "行政复议"
					},
					{
						"tag": "行政复议"
					},
					{
						"tag": "调取证据"
					},
					{
						"tag": "质证"
					},
					{
						"tag": "违法"
					}
				],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/pfnl/a25051f3312b07f33e89d5b6de18bc0a79dc89fed63cf848bdfb.html",
		"items": [
			{
				"itemType": "case",
				"caseName": "***与***合作勘查合同纠纷上诉案",
				"creators": [],
				"dateDecided": "2017-12-16",
				"court": "最高人民法院",
				"docketNumber": "（2011）民一终字第81号",
				"extra": "Genre: 民事判决书\n法宝引证码: CLI.C.10709337",
				"language": "zh-CN",
				"url": "https://www.pkulaw.com/pfnl/a25051f3312b07f33e89d5b6de18bc0a79dc89fed63cf848bdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [
					{
						"tag": "代理"
					},
					{
						"tag": "反诉"
					},
					{
						"tag": "发回重审"
					},
					{
						"tag": "另行起诉"
					},
					{
						"tag": "合同约定"
					},
					{
						"tag": "处分原则"
					},
					{
						"tag": "实际履行"
					},
					{
						"tag": "开庭审理"
					},
					{
						"tag": "恶意串通"
					},
					{
						"tag": "折价"
					},
					{
						"tag": "撤销"
					},
					{
						"tag": "支付违约金"
					},
					{
						"tag": "无效"
					},
					{
						"tag": "民事权利"
					},
					{
						"tag": "证人证言"
					},
					{
						"tag": "证据交换"
					},
					{
						"tag": "诉讼请求"
					},
					{
						"tag": "质证"
					},
					{
						"tag": "过错"
					},
					{
						"tag": "违约金"
					},
					{
						"tag": "追认"
					}
				],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/qikan/ac09f20d2f2de1f270f4052ec6ab6831bdfb.html",
		"items": [
			{
				"itemType": "journalArticle",
				"title": "重罪案件适用认罪认罚从宽制度研析",
				"creators": [
					{
						"firstName": "",
						"lastName": "董兆玲",
						"creatorType": "author",
						"fieldMode": 1
					},
					{
						"firstName": "",
						"lastName": "余斌娜",
						"creatorType": "author",
						"fieldMode": 1
					},
					{
						"firstName": "",
						"lastName": "姜玄芳",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"date": "2022",
				"abstractNote": "现阶段司法实践中，认罪认罚从宽制度在重罪案件中存在适用率低、不同类型案件适用效果差异大、控辩双方协商性不足以及理论认知偏差等问题。可通过构建梯度化量刑建议制度、完善控辩协商机制，做好证据开示工作，发挥值班律师优势，使认罪认罚从宽制度在重罪案件中更好地适用。",
				"extra": "法宝引证码: CLI.A.1333620",
				"issue": "17",
				"language": "zh-CN",
				"libraryCatalog": "北大法宝",
				"pages": "29",
				"publicationTitle": "中国检察官",
				"url": "https://www.pkulaw.com/qikan/ac09f20d2f2de1f270f4052ec6ab6831bdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [
					{
						"tag": "协商机制"
					},
					{
						"tag": "认罪认罚从宽"
					},
					{
						"tag": "重罪案件"
					},
					{
						"tag": "量刑协商"
					},
					{
						"tag": "量刑建议"
					}
				],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/qikan/aebfbcc845e9ece9fc3803f41eb10e2fbdfb.html",
		"items": [
			{
				"itemType": "journalArticle",
				"title": "法治视野下的自由贸易港立法权研究——基于央地立法权限互动的视角",
				"creators": [
					{
						"firstName": "",
						"lastName": "苏海平",
						"creatorType": "author",
						"fieldMode": 1
					},
					{
						"firstName": "",
						"lastName": "陈秋云",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"date": "2022",
				"abstractNote": "海南作为我国首个确立发展的自由贸易港，立法权限相较自由贸易试验区应当有更大选择空间。自由贸易港立法权构建的实质是中央授权与地方立法的互动，中央授权立法是地方立法权的正当性来源。自由贸易港立法权通过中央立法的地方模式与中央授权的地方立法并行推进。中央立法的地方模式将政策试验通过重大改革于法有据予以法治化，具体表现为地方试验的先行先试权、“央地会同”时期通过创制性立法权制定《海南自由贸易港法》。中央授权的地方立法是由海南依据地方立法权尤其是特殊地方立法权对一些中央权属的事项进行立法规制，特别是《海南自由贸易港法》创设的自由贸易港法规立法权，将扩充自由贸易港的地方立法权限。\nHainan Free Trade Port (FTP), as the first free trade port established in China, Legislative competence should also have more choices than China Free Trade Pilot Zone. The essence of the construction of the legislative power of FTP is the interaction between the central authorization and the local legislation, and the central authorization legislation is the source of the legitimacy of the local legislative power. The legislative power of FTP is carried forward in parallel with the local legislation authorized by the central government through the local model of central legislation. The local model of central legislation will make the policy experiment ruled by law through major reform, which is embodied in the first test right of local experiment and the formulation of the Hainan Free Trade Port Law (FTPL) through the creative legislative power during the period of “Central and local cooperation”. The local legislation authorized by the central government is the legislative power of Hainan to make laws and regulations on some matters of central ownership according to the local legislative power, especially the special local legislative power, especially the legislative power of the free trade port established by the FTPL, which will expand the local legislative power of the FTP.",
				"extra": "法宝引证码: CLI.A.1333761",
				"issue": "5",
				"language": "zh-CN",
				"libraryCatalog": "北大法宝",
				"pages": "70",
				"publicationTitle": "上海对外经贸大学学报",
				"url": "https://www.pkulaw.com/qikan/aebfbcc845e9ece9fc3803f41eb10e2fbdfb.html",
				"attachments": [
					{
						"title": "Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [
					{
						"tag": "地方立法权"
					},
					{
						"tag": "央地关系"
					},
					{
						"tag": "授权立法"
					},
					{
						"tag": "海南自由贸易港法"
					},
					{
						"tag": "自由贸易港法规"
					}
				],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://www.pkulaw.com/",
		"items": "multiple"
	}
]
/** END TEST CASES **/
