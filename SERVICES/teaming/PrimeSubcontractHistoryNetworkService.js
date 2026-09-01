'use strict';

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

function clean(v) { return String(v == null ? '' : v).trim(); }
function norm(v) { return clean(v).toUpperCase(); }
function num(v) { const n = Number(String(v ?? '').replace(/[$,]/g, '').trim()); return Number.isFinite(n) ? n : 0; }
function normalizedKey(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function valueByAliases(row, aliases) {
  const lookup = new Map(Object.keys(row || {}).map(k => [normalizedKey(k), row[k]]));
  for (const alias of aliases) {
    const value = lookup.get(normalizedKey(alias));
    if (value !== undefined && clean(value) !== '') return value;
  }
  return '';
}
function uniq(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }

const ALIASES = {
  primeName: ['prime_award_recipient_name', 'prime recipient name', 'prime_recipient_name', 'prime_awardee_name'],
  primeUei: ['prime_award_recipient_uei', 'prime recipient uei', 'prime_recipient_uei', 'prime_awardee_uei'],
  primeAwardId: ['prime_award_id', 'prime award id', 'prime_award_id_piid', 'award_id_piid', 'piid'],
  subawardId: ['subaward_id', 'subaward id', 'subaward_number'],
  subName: ['subawardee_name', 'subaward recipient name', 'recipient_name', 'subcontractor_name'],
  subUei: ['subawardee_uei', 'subaward recipient uei', 'recipient_uei', 'subcontractor_uei'],
  amount: ['subaward_amount', 'subaward amount', 'amount', 'federal_action_obligation'],
  actionDate: ['subaward_action_date', 'action_date', 'action date'],
  description: ['subaward_description', 'description', 'product_or_service_description'],
  agency: ['awarding_agency_name', 'awarding agency', 'awarding_sub_agency_name'],
  naics: ['naics_code', 'naics', 'prime_award_naics_code'],
  psc: ['product_or_service_code', 'psc', 'product service code']
};

class PrimeSubcontractHistoryNetworkService {
  constructor(options = {}) {
    this.now = options.now || (() => new Date());
  }

  parseRow(row, sourceFile) {
    const get = key => clean(valueByAliases(row, ALIASES[key]));
    const primeName = get('primeName');
    const primeUei = norm(get('primeUei'));
    const subName = get('subName');
    const subUei = norm(get('subUei'));
    if ((!primeName && !primeUei) || (!subName && !subUei)) return null;
    return {
      prime: { name: primeName || null, uei: primeUei || null },
      subcontractor: { name: subName || null, uei: subUei || null },
      primeAwardId: get('primeAwardId') || null,
      subawardId: get('subawardId') || null,
      amount: num(get('amount')),
      actionDate: get('actionDate') || null,
      description: get('description') || null,
      awardingAgency: get('agency') || null,
      naics: get('naics') || null,
      psc: get('psc') || null,
      source: 'USAspending.gov subaward export',
      sourceFile: sourceFile || null,
      confidence: 'HISTORICAL_SUBAWARD_EVIDENCE'
    };
  }

  async readCsv(filePath) {
    const rows = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', row => {
          const parsed = this.parseRow(row, filePath);
          if (parsed) rows.push(parsed);
        })
        .on('error', reject)
        .on('end', resolve);
    });
    return rows;
  }

  buildNetwork(rows = []) {
    const primes = new Map();
    for (const row of rows) {
      if (!row) continue;
      const primeKey = row.prime.uei || norm(row.prime.name);
      if (!primeKey) continue;
      if (!primes.has(primeKey)) {
        primes.set(primeKey, {
          prime: row.prime,
          totalSubawardAmount: 0,
          subawardCount: 0,
          agencies: new Set(),
          primeAwardIds: new Set(),
          subcontractors: new Map()
        });
      }
      const p = primes.get(primeKey);
      p.totalSubawardAmount += row.amount;
      p.subawardCount += 1;
      if (row.awardingAgency) p.agencies.add(row.awardingAgency);
      if (row.primeAwardId) p.primeAwardIds.add(row.primeAwardId);
      const subKey = row.subcontractor.uei || norm(row.subcontractor.name);
      if (!p.subcontractors.has(subKey)) {
        p.subcontractors.set(subKey, {
          subcontractor: row.subcontractor,
          totalAmount: 0,
          subawardCount: 0,
          agencies: new Set(),
          naics: new Set(),
          psc: new Set(),
          descriptions: new Set(),
          primeAwardIds: new Set(),
          records: []
        });
      }
      const s = p.subcontractors.get(subKey);
      s.totalAmount += row.amount;
      s.subawardCount += 1;
      if (row.awardingAgency) s.agencies.add(row.awardingAgency);
      if (row.naics) s.naics.add(row.naics);
      if (row.psc) s.psc.add(row.psc);
      if (row.description) s.descriptions.add(row.description);
      if (row.primeAwardId) s.primeAwardIds.add(row.primeAwardId);
      s.records.push(row);
    }

    return [...primes.values()].map(p => ({
      prime: p.prime,
      totalSubawardAmount: p.totalSubawardAmount,
      subawardCount: p.subawardCount,
      agencies: [...p.agencies],
      primeAwardIds: [...p.primeAwardIds],
      subcontractors: [...p.subcontractors.values()]
        .map(s => ({
          subcontractor: s.subcontractor,
          totalAmount: s.totalAmount,
          subawardCount: s.subawardCount,
          agencies: [...s.agencies],
          naics: [...s.naics],
          psc: [...s.psc],
          descriptions: [...s.descriptions].slice(0, 10),
          primeAwardIds: [...s.primeAwardIds],
          evidenceRecords: s.records.slice(0, 25),
          confidence: 'HISTORICAL_SUBAWARD_EVIDENCE'
        }))
        .sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount))
    })).sort((a, b) => Math.abs(b.totalSubawardAmount) - Math.abs(a.totalSubawardAmount));
  }

  async run(options = {}) {
    const files = (options.csvFiles || []).map(x => path.resolve(x)).filter(x => fs.existsSync(x));
    if (!files.length) return { ok:false, status:'BLOCKED', blocker:'SUBAWARD_CSV_REQUIRED', readOnly:true };
    const allRows = [];
    for (const file of files) allRows.push(...await this.readCsv(file));
    const network = this.buildNetwork(allRows);
    return {
      ok:true,
      service:'PRIME_SUBCONTRACT_HISTORY_NETWORK',
      status:network.length ? 'HISTORICAL_NETWORK_READY' : 'NO_HISTORICAL_RELATIONSHIPS_FOUND',
      generatedAt:this.now().toISOString(),
      counts:{ sourceFiles:files.length, relationships:allRows.length, primes:network.length, uniqueSubcontractors:uniq(network.flatMap(p => p.subcontractors.map(s => s.subcontractor.uei || s.subcontractor.name))).length },
      primes:network,
      evidence:{ source:'USAspending.gov subaward export', relationshipClaimsRequireParsedRow:true },
      safety:{ readOnly:true, productionOrionModified:false, instantlyModified:false, relationshipsInvented:false }
    };
  }
}

module.exports = PrimeSubcontractHistoryNetworkService;
