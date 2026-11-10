'use strict';
// Synthetic provider payloads only; shared shape with the sealed daily replay.
const assert = require('assert');
const codes = ['513310', '515880', '159582', '518880', '159570'];
function dates() {
  const result = [];let time = Date.parse('2026-10-29T00:00:00Z');
  while (result.length < 20) {
    const date = new Date(time), day = date.toISOString().slice(0, 10);
    if (![0, 6].includes(date.getUTCDay()) && !(day >= '2026-10-01' && day <= '2026-10-07')) result.unshift(day);
    time -= 86400000;
  }
  return result;
}
function bars() {return dates().map((day, i) => [day, '10', String(10 + i / 100), '11', '9', '10000', '100000']);}
function createDailyProviderAdapter({constants, state}) {
  return async config => {
      try {
        assert.strictEqual(config.method, 'get');assert.strictEqual(config.params, undefined);
        const url = config.url;let data;
        const daily = /^https:\/\/web\.ifzq\.gtimg\.cn\/appstock\/app\/fqkline\/get\?param=(sh|sz)(\d{6}),day,,,(260|320),qfq$/.exec(url);
        const sina = /^https:\/\/money\.finance\.sina\.com\.cn\/quotes_service\/api\/json_v2\.php\/CN_MarketData\.getKLineData\?symbol=(sh|sz)(\d{6})&scale=240&ma=no&datalen=260$/.exec(url);
        const premium = /^https:\/\/push2\.eastmoney\.com\/api\/qt\/stock\/get\?secid=([01])\.(\d{6})&fields=f43,f57,f58,f60,f127,f162,f169,f170,f171$/.exec(url);
        const weekly = /^https:\/\/web\.ifzq\.gtimg\.cn\/appstock\/app\/fqkline\/get\?param=([A-Za-z0-9]+),week,,,60,$/.exec(url);
        if (daily) {
          const code = daily[2];assert([...codes, ...constants.GEN1_BENCHMARK_CODES].includes(code));
          assert.strictEqual(daily[1], code.startsWith('5') ? 'sh' : 'sz');
          assert.strictEqual(daily[3], codes.includes(code) ? '260' : '320');
          const rows = state.definition.fallback && code === codes[0] ? bars().slice(1) : bars();
          data = {data: {[daily[1] + code]: {qfqday: rows}}};
        } else if (sina) {
          assert(state.definition.fallback && sina[2] === codes[0]);assert.strictEqual(sina[1], 'sh');
          assert.strictEqual(config.responseType, 'text');
          data = JSON.stringify(bars().map(row => ({day: row[0], open: row[1], close: row[2], high: row[3], low: row[4], volume: row[5]})));
        } else if (premium) {
          assert(codes.includes(premium[2]));assert.strictEqual(premium[1], premium[2].startsWith('5') ? '1' : '0');
          data = {data: {f43: 10, f127: 10.2, f162: 0.3}};
        } else if (url === 'https://api.stlouisfed.org/fred/series/observations?series_id=DFII10&api_key=fixture-no-real-credential&file_type=json') {
          data = {observations: [{date: '2026-10-28', value: '.'}, {date: '2026-10-29', value: '1.7'}]};
        } else if (url === 'https://qt.gtimg.cn/q=whDINIW') {
          assert.strictEqual(config.responseType, 'arraybuffer');data = Buffer.from('v_fixture="310~synthetic~DINIW~99.64~0~20261029220000~99.6";');
        } else if (url === 'https://www.chinaflashmarket.com/') {
          data = state.definition.badStorage ? 'fixture-missing-prices' :
            '<th><a href="/price/ews/100222">DDR</a></th><span class="new-price"><b>$</b> 3.2</span>' +
            '<th><a href="/price/in/100164">NAND</a></th><span class="new-price"><b>$</b> 4.1</span>';
        } else if (url === 'https://t-goldream.com/gold-observation?section=global-gold-etf') {
          data = '<tr data-etf-toggle="daily-etf-history-gld"><td>2026-10-29</td><td>1000.5吨</td></tr>';
        } else if (weekly) {
          assert(constants.MARKET_INDEXES.some(item => item.symbol === weekly[1]));data = {data: {[weekly[1]]: {week: bars()}}};
        } else if (url.startsWith('https://qt.gtimg.cn/q=')) {
          const symbol = url.slice('https://qt.gtimg.cn/q='.length);assert(constants.GLOBAL_TICKERS.some(item => item.symbol === symbol));
          assert.strictEqual(config.responseType, 'arraybuffer');const fields = Array(38).fill('');
          fields[3] = '10';fields[5] = '9.9';fields[32] = '1.01';fields[33] = '11';fields[34] = '9';
          data = Buffer.from('v_fixture="' + fields.join('~') + '";');
        } else {throw Error('UNREVIEWED_PROVIDER_REQUEST');}
        state.provider.push({url, method: config.method, responseType: config.responseType || null});
        return {status: 200, statusText: 'OK', headers: {}, config, data, request: {fixture: true}};
      } catch (error) {state.rejected.push({boundary: 'provider', reason: error.message});throw error;}
    };
}
module.exports = {createDailyProviderAdapter};
