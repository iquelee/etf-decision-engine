'use strict';
// Test-only flat document backend; no SDK, network, credentials or production data.
const assert = require('assert');
const copy = value => JSON.parse(JSON.stringify(value));
function createDatabase() {
  const documents = new Map(), calls = [];
  function collection(name) {
    assert(/^runtime24_admission_probe_[a-z0-9_]+$/.test(name));
    const key = id => name + '/' + id;
    return {
      doc(id) { return {async get() {
        calls.push({action: 'get', collection: name, id});
        return {data: documents.has(key(id)) ? [copy(documents.get(key(id)))] : []};
      }}; },
      async add(row) {
        calls.push({action: 'add', collection: name, id: row._id});
        if (documents.has(key(row._id))) throw Error('duplicate primary key');
        documents.set(key(row._id), copy(row)); return {id: row._id};
      },
      where(filter) { return {async update(values) {
        calls.push({action: 'update', collection: name, filter: copy(filter), values: copy(values)});
        const row = documents.get(key(filter._id));
        if (!row || !Object.entries(filter).every(([k, v]) => row[k] === v)) return {updated: 0};
        Object.assign(row, copy(values)); return {updated: 1};
      }}; }
    };
  }
  return {collection, calls};
}
module.exports = {createDatabase};
