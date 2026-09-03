'use strict';

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

function clean(v) { return String(v == null ? '' : v).trim(); }
function header(v) { return clean(v).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function first(row, names) { for (const name of names) { const value = row?.[header(name)]; if (value != null && clean(value) !== '') return value; } return null; }
function dateOnly(v) { const d = new Date(v || 0); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
function boolish(v) {
  const value = clean(v).toLowerCase();
  if (!value) return null;
  if (['true','1','yes','y','active'].includes(value)) return true;
  if (['false','0','no','n','inactive','archived'].includes(value)) return false;
  return null;
}

class SamOpportunityNaicsIndexService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.cacheDir = path.join(this.rootDir, 'DATA', 'demo_cache');
    this.indexFile = path.join(this.cacheDir, 'sam_current_opportunity_naics_index.json');
    this.metaFile = path.join(this.cacheDir, 'sam_current_opportunity_naics_index.meta.json');
    this.memory = null;
    this.memorySource = null;
    this.buildPromise = null;
  }

  sourceFingerprint(file) {
    const stat = fs.statSync(file);
    return `${path.resolve(file)}|${stat.size}|${stat.mtimeMs}`;
  }

  loadPersisted(fingerprint) {
    if (!fs.existsSync(this.indexFile) || !fs.existsSync(this.metaFile)) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(this.metaFile, 'utf8'));
      if (meta.fingerprint !== fingerprint) return null;
      const index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      if (!index || typeof index !== 'object') return null;
      this.memory = index;
      this.memorySource = fingerprint;
      return index;
    } catch {
      return null;
    }
  }

  async build(file) {
    const fingerprint = this.sourceFingerprint(file);
    if (this.memory && this.memorySource === fingerprint) return this.memory;
    const persisted = this.loadPersisted(fingerprint);
    if (persisted) return persisted;
    if (this.buildPromise) return this.buildPromise;

    this.buildPromise = new Promise((resolve, reject) => {
      const index = Object.create(null);
      let scanned = 0;
      fs.createReadStream(file)
        .pipe(csv({ mapHeaders: ({ header: h }) => header(h) }))
        .on('data', row => {
          scanned += 1;
          const naics = clean(first(row, ['naicsCode','naics','primaryNaics'])).replace(/\D/g,'');
          if (naics.length < 5) return;
          const active = boolish(first(row,['active','isActive']));
          if (active === false) return;
          if (!index[naics]) index[naics] = [];
          index[naics].push(row);
        })
        .on('error', reject)
        .on('end', () => {
          try {
            fs.mkdirSync(this.cacheDir, { recursive:true });
            const tmpIndex = `${this.indexFile}.tmp`;
            const tmpMeta = `${this.metaFile}.tmp`;
            fs.writeFileSync(tmpIndex, JSON.stringify(index));
            fs.writeFileSync(tmpMeta, JSON.stringify({ fingerprint, scanned, builtAt:new Date().toISOString() }, null, 2));
            fs.renameSync(tmpIndex, this.indexFile);
            fs.renameSync(tmpMeta, this.metaFile);
          } catch {}
          this.memory = index;
          this.memorySource = fingerprint;
          resolve(index);
        });
    }).finally(() => { this.buildPromise = null; });

    return this.buildPromise;
  }

  async rowsForNaics(file, naicsCodes) {
    const started = Date.now();
    const index = await this.build(file);
    const keys = [...new Set((naicsCodes || []).map(x => clean(x).replace(/\D/g,'')).filter(x => x.length >= 5))];
    const rows = [];
    for (const key of keys) rows.push(...(Array.isArray(index[key]) ? index[key] : []));
    return { rows, lookupMs:Date.now()-started, indexedNaics:keys, cacheKind:'PERSISTED_NAICS_INDEX' };
  }
}

module.exports = SamOpportunityNaicsIndexService;
