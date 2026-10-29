'use strict';
// Executes the WHOLE unmodified entry and common modules in a separate VM.
// SDK/database boundary is memory-only. No network, credentials or cloud calls.
const fs = require('fs'), path = require('path'), vm = require('vm');
const assert = require('assert');
const copy = value => JSON.parse(JSON.stringify(value));
const codes = ['513310', '515880', '159582', '518880', '159570'];

function createHarness(root, options = {}) {
  root = path.resolve(root);
  const common = path.resolve(options.common || path.join(root, 'common'));
  const tables = new Map(), writes = [], diagnostics = [], cache = new Map();
  let sequence = 0, onWrite = options.onWrite;
  const now = options.now || '2026-10-29T08:00:00+08:00';
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  }
  const rows = name => { if (!tables.has(name)) tables.set(name, []); return tables.get(name); };
  const matches = (row, filter) => Object.entries(filter).every(([k, v]) => row[k] === v);
  function collection(name, filter = {}, order = [], offset = 0, limit = Infinity) {
    const select = () => {
      const list = rows(name).filter(row => matches(row, filter));
      list.sort((a, b) => { for (const [k, dir] of order) {
        if (a[k] < b[k]) return dir === 'desc' ? 1 : -1;
        if (a[k] > b[k]) return dir === 'desc' ? -1 : 1;
      } return 0; });
      return list.slice(offset, offset + limit);
    };
    return {
      where: f => collection(name, f, order, offset, limit),
      orderBy: (k, dir) => collection(name, filter, [...order, [k, dir]], offset, limit),
      skip: n => collection(name, filter, order, n, limit),
      limit: n => collection(name, filter, order, offset, n),
      doc: id => collection(name, {_id: id}, order, offset, limit),
      async get() { return {data: copy(select())}; },
      async add(doc) {
        if (onWrite) await onWrite(name, 'add');
        const value = copy(doc); if (!value._id) value._id = 'fixture:' + (++sequence);
        if (rows(name).some(r => r._id === value._id)) throw Error('duplicate key');
        rows(name).push(value); writes.push({collection: name, operation: 'add'});
        return {id: value._id};
      },
      async update(doc) {
        if (onWrite) await onWrite(name, 'update');
        const selected = select(); selected.forEach(row => Object.assign(row, copy(doc)));
        writes.push({collection: name, operation: 'update', updated: selected.length});
        return {updated: selected.length};
      }
    };
  }
  const database = {collection, command: {}, async createCollection(name) { rows(name); }};
  const sdk = {SYMBOL_CURRENT_ENV: 'offline-fixture', init: () => ({database: () => database,
    callFunction: () => { throw Error('OFFLINE_FUNCTION_CALL_DENIED'); }})};
  function permitted(file) {
    const full = path.resolve(String(file));
    const within = base => full === base || full.startsWith(base + path.sep);
    return (within(root) || within(common)) && !/^(config\.json|\.env.*|cloudbaserc.*)$/i.test(path.basename(full));
  }
  const readonlyFs = {existsSync: file => permitted(file) && fs.existsSync(file),
    readFileSync: (file, encoding) => { assert(permitted(file), 'OFFLINE_FILE_DENIED'); return fs.readFileSync(file, encoding); }};
  function load(request, parent = path.join(root, 'index.js')) {
    if (request === '@cloudbase/node-sdk') return sdk;
    if (request === 'fs') return readonlyFs;
    if (['path', 'crypto'].includes(request)) return require(request);
    if (!request.startsWith('.') && !path.isAbsolute(request)) throw Error('OFFLINE_MODULE_DENIED:' + request);
    let file = path.resolve(path.dirname(parent), request);
    const commonPrefix = path.join(root, 'common');
    if (file === commonPrefix || file.startsWith(commonPrefix + path.sep)) file = common + file.slice(commonPrefix.length);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (fs.existsSync(file + '.js')) file += '.js';
      else if (fs.existsSync(file + '.json')) file += '.json';
      else file = path.join(file, 'index.js');
    }
    assert(permitted(file), 'OFFLINE_MODULE_PATH_DENIED');
    if (cache.has(file)) return cache.get(file).exports;
    const module = {exports: {}}; cache.set(file, module);
    if (file.endsWith('.json')) module.exports = JSON.parse(fs.readFileSync(file, 'utf8'));
    else {
      const box = {module, exports: module.exports, require: req => load(req, file), __filename: file,
        __dirname: path.dirname(file), Date: Clock, Buffer, process: {env: {}},
        console: {log() {}, warn() {}, error: (...args) => diagnostics.push(args.map(String).join(' '))}};
      vm.runInNewContext(fs.readFileSync(file, 'utf8'), box, {filename: file, timeout: 10000});
    }
    return module.exports;
  }
  const constants = load('./common/constants');
  const indicators = load('./common/utils/indicators');
  const calendar = load('./common/utils/cn-trading-calendar');
  const authority = calendar.resolveExpectedTradeDate
    ? calendar.resolveExpectedTradeDate(new Clock(), calendar.loadRepoCalendar())
    : load('./common/utils/v365-run-integrity').resolveExpectedTradeDate(new Clock(), calendar.loadRepoCalendar());
  const date = authority.expected_trade_date;
  assert(date, 'fixture date must be covered by packaged calendar');
  const etfs = codes.map((code, i) => ({code, name: 'synthetic-' + code, status: 'enable', sort_order: i,
    sector: ['storage', 'ai_network', 'semi_equip', 'gold', 'biotech'][i], target_position: 20, max_position: 30}));
  rows('etf_basic').push(...etfs);
  // Actual db.getParamConfig expects individual key/value records.
  tables.set('param_config', Object.entries({...constants.DEFAULT_PARAMS, trend_stage_enabled: true,
    v365_integrity_mode: 'ENFORCE'}).map(([key, value]) => ({key, value, version: 1})));
  rows('portfolio_snapshot').push({_id: 'fixture:portfolio', snapshot_date: '2026-09-29', total_asset: 100000,
    cash_balance: 100000, holdings_mv: 0, positions: []});
  for (const [j, etf] of etfs.entries()) {
    const bars = [];
    for (let t = Date.UTC(2025, 0, 1), i = 0; t <= new Date(date + 'T00:00:00Z').getTime(); t += 86400000) {
      if ([0, 6].includes(new Date(t).getUTCDay())) continue;
      const close = 10 + j + i * 0.01 + Math.sin(i++ / 17) * 0.1;
      bars.push({code: etf.code, trade_date: new Date(t).toISOString().slice(0, 10),
        open: close - 0.02, high: close + 0.1, low: close - 0.1, close, volume: 1000000, amount: close * 1000000, is_final: true});
    }
    rows('etf_daily').push(...bars);
    rows('indicator_snapshot').push(indicators.computeSnapshot(bars, constants.DEFAULT_PARAMS,
      {code: etf.code, calc_date: date, premium_rate: 0, version: 1}));
    rows('portfolio_position').push({code: etf.code, current_position: 0, core_position: 0,
      trade_position: 0, shares: 0, target_std: 20, target_max: 30});
  }
  const entry = load('./index.js');
  return {entry, load, writes, diagnostics, date, rows: name => copy(rows(name)),
    setOnWrite(fn) { onWrite = fn; },
    setRows(name, values) { tables.set(name, copy(values)); },
    async run(event = {}) { return entry.main(event, {}); }};
}
module.exports = {createHarness};
