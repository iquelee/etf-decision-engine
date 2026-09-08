const cloudbase = require('@cloudbase/node-sdk');
const fs = require('fs');
const path = require('path');

const credPath = path.join(process.env.USERPROFILE, '.config', '.cloudbase', 'auth.json');
let secretId, secretKey;
try {
  const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  secretId = cred.credential.secretId;
  secretKey = cred.credential.secretKey;
} catch (e) {
  console.error('No credentials found:', credPath, e.message);
  process.exit(1);
}

const app = cloudbase.init({
  env: 'tradingview-etf-d0fa42yy57cbc11b',
  secretId, secretKey
});
const db = app.database();
const _ = db.command;

const SEC_TICKERS = [
  { symbol: 'usMU', name: '美光科技', code: 'MU', related: ['513310'] },
  { symbol: 'usAMAT', name: '应用材料', code: 'AMAT', related: ['159582'] },
  { symbol: 'usASML', name: '阿斯麦', code: 'ASML', related: ['159582'] },
  { symbol: 'usTSM', name: '台积电', code: 'TSM', related: ['159582', '513310'] },
  { symbol: 'usNVDA', name: '英伟达', code: 'NVDA', related: ['515880', '513310', '159582'] },
  { symbol: 'usAMD', name: 'AMD', code: 'AMD', related: ['513310'] },
  { symbol: 'usMSFT', name: '微软', code: 'MSFT', related: ['515880', '513310'] },
  { symbol: 'usGOOGL', name: '谷歌', code: 'GOOGL', related: ['515880', '513310'] },
  { symbol: 'usORCL', name: '甲骨文', code: 'ORCL', related: ['515880', '513310'] },
  { symbol: 'usBGNE', name: '百济神州', code: 'BGNE', related: ['159570'] },
  { symbol: 'usZLAB', name: '再鼎医药', code: 'ZLAB', related: ['159570'] },
  { symbol: 'usHCM', name: '和黄医药', code: 'HCM', related: ['159570'] },
  { symbol: 'usMRVL', name: '迈威尔', code: 'MRVL', related: ['515880'] },
  { symbol: 'usAMZN', name: '亚马逊', code: 'AMZN', related: ['515880', '513310'] },
  { symbol: 'usMETA', name: 'Meta', code: 'META', related: ['515880', '513310'] }
];

async function loadHoldings(code) {
  const res = await db.collection('etf_holdings').where({ code }).limit(40).get();
  return res.data || [];
}

function isEvidenceValid(e, code, hNames, hCodes) {
  const { stock_name, stock_code, source } = e;
  if (!stock_name && !stock_code) return true;
  // 持仓匹配优先
  if (hNames.has(stock_name) || hCodes.has(stock_code)) return true;
  // SEC 财报 evidence：检查 SEC_TICKERS 映射
  if (source === 'sec') {
    for (const t of SEC_TICKERS) {
      if ((t.name === stock_name || t.code === stock_code) && t.related && t.related.includes(code)) return true;
    }
    return false;
  }
  return false;
}

async function main() {
  const targets = ['513310', '515880', '159582', '518880', '159570'];
  let totalDeleted = 0;

  for (const code of targets) {
    const holdings = await loadHoldings(code);
    const hNames = new Set(holdings.map(h => h.stock_name).filter(Boolean));
    const hCodes = new Set(holdings.map(h => h.stock_code).filter(Boolean));

    const res = await db.collection('fundamental_evidence')
      .where({ code })
      .limit(1000)
      .get();

    const evidence = res.data || [];
    const toDelete = [];

    for (const e of evidence) {
      if (!isEvidenceValid(e, code, hNames, hCodes)) {
        toDelete.push({ _id: e._id, indicator: e.indicator, stock_name: e.stock_name, stock_code: e.stock_code, source: e.source });
      }
    }

    if (toDelete.length > 0) {
      console.log(`Code ${code}: ${evidence.length} total, ${toDelete.length} to delete`);
      for (const d of toDelete.slice(0, 10)) {
        console.log(`  DEL: ${d.indicator} | ${d.stock_name} (${d.stock_code}) | src=${d.source}`);
      }
      for (let i = 0; i < toDelete.length; i += 20) {
        const batch = toDelete.slice(i, i + 20);
        const ids = batch.map(b => b._id);
        try {
          await db.collection('fundamental_evidence').where({ _id: _.in(ids) }).remove();
          totalDeleted += batch.length;
        } catch (e) {
          console.error(`  Delete error: ${e.message}`);
        }
      }
    } else {
      console.log(`Code ${code}: ${evidence.length} total, all valid`);
    }
  }

  console.log(`\nTotal deleted: ${totalDeleted}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
