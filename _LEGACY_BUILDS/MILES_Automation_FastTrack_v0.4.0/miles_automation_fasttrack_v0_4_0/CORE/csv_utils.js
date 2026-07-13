'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && inQuotes && next === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function csvEscape(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const row = {};
    headers.forEach((h, idx) => row[h] = vals[idx] === undefined ? '' : vals[idx]);
    return row;
  });
}

function writeCsv(filePath, rows, preferredHeaders) {
  ensureDir(filePath);
  const headers = preferredHeaders && preferredHeaders.length
    ? preferredHeaders
    : Array.from(rows.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set; }, new Set()));
  const body = [headers.join(',')].concat(rows.map(r => headers.map(h => csvEscape(r[h])).join(','))).join('\n') + '\n';
  fs.writeFileSync(filePath, body, 'utf8');
}

function appendCsv(filePath, row, preferredHeaders) {
  let rows = readCsv(filePath);
  rows.push(row);
  writeCsv(filePath, rows, preferredHeaders);
}

function countRows(filePath) { return readCsv(filePath).length; }

module.exports = { readCsv, writeCsv, appendCsv, countRows, ensureDir };
