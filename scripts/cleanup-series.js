const cloudbase = require('@cloudbase/node-sdk');
const fs = require('fs');
const path = require('path');

const credPath = path.join(process.env.USERPROFILE, '.config', '.cloudbase', 'auth.json');
const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const app = cloudbase.init({
  env: 'tradingview-etf-d0fa42yy57cbc11b',
  secretId: cred.credential.secretId,
  secretKey: cred.credential.secretKey
});
const db = app.database();
const _ = db.command;

// Keywords that indicate cross-contamination (tech companies appearing in 创新药/黄金 series)
const CONTAMINATION_KEYWORDS = ['美光科技', 'AMD', 'MU', '甲骨文', 'ORCL', '微软', 'MSFT', '谷歌', 'GOOGL', '亚马逊', 'AMZN', 'Meta', 'META', 'SK海力士', '000660', '台积电', 'TSM'];

async function main() {
  // 1. Check 159570 series entries for contamination
  const res = await db.collection('fundamental_series').where({ code: '159570' }).get();
  const series = res.data || [];
  
  let contaminatedIds = [];
  let cleanIds = [];
  
  for (const s of series) {
    const note = s.note || '';
    const isContaminated = CONTAMINATION_KEYWORDS.some(kw => note.includes(kw));
    if (isContaminated) {
      contaminatedIds.push({ id: s._id, indicator: s.indicator, note: note.slice(0, 80) });
    } else {
      cleanIds.push({ id: s._id, indicator: s.indicator, note: note.slice(0, 80) });
    }
  }
  
  console.log(`159570 series: ${series.length} total, ${contaminatedIds.length} contaminated, ${cleanIds.length} clean`);
  
  if (contaminatedIds.length > 0) {
    console.log('\nContaminated entries:');
    for (const c of contaminatedIds) {
      console.log(`  ${c.indicator}: ${c.note}`);
    }
    
    // Delete contaminated entries
    const ids = contaminatedIds.map(c => c.id);
    for (let i = 0; i < ids.length; i += 20) {
      const batch = ids.slice(i, i + 20);
      await db.collection('fundamental_series').where({ _id: _.in(batch) }).remove();
    }
    console.log(`\nDeleted ${ids.length} contaminated entries from 159570`);
  }
  
  // 2. Do the same for 513310 - check if any series entries have wrong data
  // (513310 is 存储芯片, so 美光科技, AMD, SK海力士 are CORRECT for this ETF)
  // We should NOT clean 513310 series
  
  // 3. Also clean 515880 series if any contamination
  const res2 = await db.collection('fundamental_series').where({ code: '515880' }).get();
  const series2 = res2.data || [];
  let contaminated2 = [];
  for (const s of series2) {
    const note = s.note || '';
    // For 515880 (通信ETF/光模块), AAOI, META, NVDA, MSFT are correct
    // But check for obvious non-communication companies
    const badForComms = CONTAMINATION_KEYWORDS.filter(kw => 
      ['美光科技', 'AMD', 'MU', 'SK海力士', '000660', '台积电', 'TSM'].includes(kw) && note.includes(kw)
    );
    if (badForComms.length > 0) {
      contaminated2.push({ id: s._id, indicator: s.indicator, note: note.slice(0, 80) });
    }
  }
  
  if (contaminated2.length > 0) {
    console.log(`\n515880: ${contaminated2.length} contaminated entries found`);
    const ids2 = contaminated2.map(c => c.id);
    for (let i = 0; i < ids2.length; i += 20) {
      const batch = ids2.slice(i, i + 20);
      await db.collection('fundamental_series').where({ _id: _.in(batch) }).remove();
    }
    console.log(`Deleted ${ids2.length} contaminated entries from 515880`);
  } else {
    console.log(`\n515880: No contamination found`);
  }
  
  // 4. Also check 159582 series
  const res3 = await db.collection('fundamental_series').where({ code: '159582' }).get();
  const series3 = res3.data || [];
  let contaminated3 = [];
  for (const s of series3) {
    const note = s.note || '';
    // For 159582 (半导体设备), ASML, AMAT, TSM are correct
    // But 美光科技, AMD, MSFT would be wrong
    const badForEquip = ['美光科技', 'AMD', 'MU', '甲骨文', 'ORCL', '微软', 'MSFT', 'Meta', 'META'];
    const found = badForEquip.filter(kw => note.includes(kw));
    if (found.length > 0) {
      contaminated3.push({ id: s._id, indicator: s.indicator, note: note.slice(0, 80) });
    }
  }
  
  if (contaminated3.length > 0) {
    console.log(`\n159582: ${contaminated3.length} contaminated entries found`);
    for (const c of contaminated3) {
      console.log(`  ${c.indicator}: ${c.note}`);
    }
    const ids3 = contaminated3.map(c => c.id);
    for (let i = 0; i < ids3.length; i += 20) {
      const batch = ids3.slice(i, i + 20);
      await db.collection('fundamental_series').where({ _id: _.in(batch) }).remove();
    }
    console.log(`Deleted ${ids3.length} contaminated entries from 159582`);
  } else {
    console.log(`\n159582: No contamination found`);
  }
  
  console.log('\nDone cleaning. Now trigger rollup_all to regenerate series from valid evidence.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
