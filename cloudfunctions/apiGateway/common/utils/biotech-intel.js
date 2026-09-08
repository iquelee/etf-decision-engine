/**
 * 创新药事件源解析（无网络，便于单测）
 * 东财搜索补 CDE/获批/BD；ClinicalTrials.gov + openFDA 补官方审批/临床状态。
 * 持仓用现价十大匹配，不写死名单。
 */
'use strict';

const { padHkCode } = require('./overseas-filings');

/** 港股创新药别名：代码 / 中文名 / 核心产品 / 英文申办方 / FDA 商品名 / 双上市 SEC */
const BIOTECH_ALIASES = [
  { hk: '01801', names: ['信达生物', '信達生物', 'Innovent'], searchName: '信达生物', products: ['单抗', '信迪利单抗', '达伯舒', 'TYVYT'], sponsors: ['Innovent'], brands: [] },
  { hk: '06160', names: ['百济神州', '百濟神州', 'BeiGene', 'BeOne'], searchName: '百济神州', products: ['泽布替尼', 'BRUKINSA', '百悦泽'], sponsors: ['BeiGene'], brands: ['BRUKINSA', 'TEVIMBRA'], sec: { symbol: 'usBGNE', code: 'BGNE', cik: '0001651308' } },
  { hk: '09926', names: ['康方生物', '康方', 'Akeso'], searchName: '康方生物', products: ['依沃西', '依沃西单抗', 'ivonescimab'], sponsors: ['Akeso'], brands: [] },
  { hk: '03692', names: ['翰森制药', '翰森製藥', '汉森制药', 'Hansoh'], searchName: '翰森制药', products: ['阿美替尼', '阿美乐', 'aumolertinib'], sponsors: ['Hansoh'], brands: [] },
  { hk: '02359', names: ['药明康德', '藥明康德', 'WuXi AppTec', '药明'], searchName: '药明康德', products: ['CRO', 'CRO服务', 'CXO'], sponsors: ['WuXi AppTec'], brands: [] },
  { hk: '01177', names: ['中国生物制药', '中國生物製藥', 'Sino Biopharm'], searchName: '中国生物制药', products: [], sponsors: ['Sino Biopharmaceutical'], brands: [] },
  { hk: '02269', names: ['药明生物', '藥明生物', 'WuXi Biologics'], searchName: '药明生物', products: ['CDMO'], sponsors: ['WuXi Biologics'], brands: [] },
  { hk: '01093', names: ['石药集团', '石藥集團', 'CSPC'], searchName: '石药集团', products: [], sponsors: ['CSPC'], brands: [] },
  { hk: '01530', names: ['三生制药', '三生製藥', '3SBio'], searchName: '三生制药', products: [], sponsors: ['3SBio'], brands: [] },
  { hk: '01877', names: ['君实生物', '君實生物', 'Junshi'], searchName: '君实生物', products: ['特瑞普利单抗'], sponsors: ['Junshi'], brands: [] },
  { hk: '09688', names: ['再鼎医药', '再鼎醫藥', 'Zai Lab'], searchName: '再鼎医药', products: [], sponsors: ['Zai Lab'], brands: ['QINLOCK'], sec: { symbol: 'usZLAB', code: 'ZLAB', cik: '0001704292' } },
  { hk: '00013', names: ['和黄医药', '和黃醫藥', 'HUTCHMED', '和黄'], searchName: '和黄医药', products: [], sponsors: ['HUTCHMED'], brands: ['FRUZAQLA'], sec: { symbol: 'usHCM', code: 'HCM', cik: '0001648257' } }
];

/** A 股原料药/仿制药等，不得当作港股通创新药核心产品 */
const OFF_UNIVERSE_RE = /鲁抗|鲁抗医药|600789|恒瑞医药|恒瑞|原料药上市|化学原料药/;

function coreSalesPromptHint() {
  return '港股通创新药「核心产品销售」只看该 ETF 前十大持仓的商业化产品，例如：百济神州-泽布替尼、信达生物-单抗、康方生物-依沃西、翰森制药-阿美替尼、药明康德-CRO服务。不要把鲁抗、原料药、仿制药、A股化学药当核心产品。没有持股标注的赛道新闻不要打 core_sales。';
}

function isOffUniverseBiotech(text) {
  return OFF_UNIVERSE_RE.test(String(text || ''));
}

/** 核心产品销售：必须挂在前十持仓上，且不是鲁抗等圈外标的 */
function isCoreSalesAllowed(item) {
  const blob = [item && item.title, item && item.stock_name, item && item.stock_code, item && item.reason, item && item.note]
    .filter(Boolean).join(' ');
  if (isOffUniverseBiotech(blob)) return false;
  const name = String((item && item.stock_name) || '').trim();
  const code = String((item && item.stock_code) || '').trim();
  return !!(name || code);
}

const EVENT_KEYWORDS = /获批|批准|CDE|FDA|临床|NDA|BLA|授权|license|BD|优先审评|突破性|失败|终止|受理|上市许可|IND|III期|III 期|3期|三期|新药|适应症/i;

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function matchBiotechAlias(holding) {
  const code = padHkCode((holding && (holding.stock_code || holding.hk)) || '');
  const name = String((holding && (holding.stock_name || holding.name)) || '');
  return BIOTECH_ALIASES.find((a) => a.hk === code || a.names.some((n) => name && name.indexOf(n) >= 0)) || null;
}

function isBiotechEvent(item) {
  const blob = `${(item && item.title) || ''} ${(item && item.summary) || ''}`;
  return EVENT_KEYWORDS.test(blob);
}

function inDateWindow(iso, startDate, endDate) {
  const d = String(iso || '').slice(0, 10);
  if (!d) return false;
  return (!startDate || d >= startDate) && (!endDate || d <= endDate);
}

function inYmdWindow(ymd, startDate, endDate) {
  const s = String(ymd || '').replace(/-/g, '');
  if (s.length < 8) return false;
  const d = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return inDateWindow(d, startDate, endDate);
}

function eastmoneySearchUrl(keyword, pageSize = 8) {
  const param = {
    uid: '',
    keyword: String(keyword || ''),
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: {
      cmsArticleWebOld: {
        searchScope: 'default',
        sort: 'default',
        pageIndex: 1,
        pageSize
      }
    }
  };
  return `https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${encodeURIComponent(JSON.stringify(param))}`;
}

function parseEastmoneySearchJsonp(body) {
  const text = String(body || '').trim();
  const m = text.match(/^[^(]+\(([\s\S]*)\)\s*;?\s*$/);
  const json = m ? m[1] : text;
  let data;
  try { data = JSON.parse(json); } catch (e) { return []; }
  const rows = (data && data.result && data.result.cmsArticleWebOld) || [];
  return rows.map((r) => {
    const title = stripHtml(r.title);
    const date = String(r.date || '');
    let time = null;
    if (/^\d{4}-\d{2}-\d{2}/.test(date)) {
      time = new Date(date.replace(' ', 'T') + '+08:00').toISOString();
    }
    return {
      title,
      time,
      url: r.url || '',
      secName: r.mediaName || '',
      summary: stripHtml(r.content).slice(0, 200),
      news_code: String(r.code || '')
    };
  }).filter((x) => x.title);
}

function parseClinicalTrials(data) {
  const studies = (data && data.studies) || [];
  return studies.map((s) => {
    const p = s.protocolSection || {};
    const id = p.identificationModule || {};
    const st = p.statusModule || {};
    const sp = p.sponsorCollaboratorsModule || {};
    const des = p.designModule || {};
    const cond = p.conditionsModule || {};
    const nct = id.nctId || '';
    const date = (st.lastUpdatePostDateStruct && st.lastUpdatePostDateStruct.date) || st.lastUpdatePostDate || '';
    const phases = des.phases || [];
    return {
      title: id.briefTitle || '',
      status: st.overallStatus || '',
      phase: phases.join('/'),
      time: date ? new Date(`${date}T00:00:00Z`).toISOString() : null,
      url: nct ? `https://clinicaltrials.gov/study/${nct}` : '',
      nctId: nct,
      sponsor: (sp.leadSponsor && sp.leadSponsor.name) || '',
      conditions: (cond.conditions || []).join('、')
    };
  }).filter((x) => x.title);
}

function parseOpenFda(data) {
  if (!data || data.error) return [];
  const results = data.results || [];
  const out = [];
  for (const r of results) {
    const brand = ((r.openfda && r.openfda.brand_name) || [])[0]
      || ((r.products || [])[0] && r.products[0].brand_name) || '';
    const subs = r.submissions || [];
    const ap = subs.find((s) => s.submission_status === 'AP') || subs[0];
    if (!ap) continue;
    const ymd = String(ap.submission_status_date || '');
    const iso = ymd.length === 8 ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` : '';
    const docs = ap.application_docs || [];
    const letter = docs.find((d) => d.type === 'Letter') || docs[0];
    out.push({
      brand,
      sponsor: r.sponsor_name || '',
      application: r.application_number || '',
      submissionType: ap.submission_type || '',
      status: ap.submission_status || '',
      statusDate: ymd,
      time: iso ? new Date(`${iso}T00:00:00Z`).toISOString() : null,
      url: (letter && letter.url) || ''
    });
  }
  return out;
}

function formatTrialTitle(row) {
  const extra = [row.status, row.phase].filter(Boolean).join(' ');
  return `[临床] ${row.title}${extra ? '｜' + extra : ''}`;
}

function formatFdaTitle(row) {
  return `[FDA] ${row.brand || row.application} ${row.submissionType || ''} ${row.status || ''} ${row.statusDate || ''}`.replace(/\s+/g, ' ').trim();
}

module.exports = {
  BIOTECH_ALIASES,
  EVENT_KEYWORDS,
  OFF_UNIVERSE_RE,
  coreSalesPromptHint,
  isOffUniverseBiotech,
  isCoreSalesAllowed,
  matchBiotechAlias,
  isBiotechEvent,
  inDateWindow,
  inYmdWindow,
  eastmoneySearchUrl,
  parseEastmoneySearchJsonp,
  parseClinicalTrials,
  parseOpenFda,
  formatTrialTitle,
  formatFdaTitle
};
