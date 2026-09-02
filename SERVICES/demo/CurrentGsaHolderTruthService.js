'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const GsaHolderSnapshotService = require('../GsaHolderSnapshotService');

function clean(v) { return String(v == null ? '' : v).trim(); }
function norm(v) { return clean(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } }
function ageHours(iso, nowMs = Date.now()) { const ms = Date.parse(iso || ''); return Number.isFinite(ms) ? (nowMs - ms) / 3600000 : null; }

async function findJsonl(file, predicate) {
  if (!file || !fs.existsSync(file)) return [];
  const found = [];
  const input = fs.createReadStream(file, { encoding:'utf8' });
  const lines = readline.createInterface({ input, crlfDelay:Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (predicate(row)) found.push(row);
  }
  return found;
}

class CurrentGsaHolderTruthService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.live = options.liveService || new GsaHolderSnapshotService({ root:this.rootDir, timeoutMs:Number(options.timeoutMs || 30000) });
    this.maxStagingAgeHours = Math.max(24, Number(options.maxStagingAgeHours || process.env.MILES_GSA_FRESHNESS_MAX_HOURS || 7 * 24));
    this.now = options.now ? new Date(options.now) : null;
    this.allowLive = options.allowLive !== false;
  }

  matchRows(rows, uei, companyName) {
    const targetUei = norm(uei);
    const targetName = norm(companyName);
    if (targetUei) {
      const exact = rows.filter(row => norm(row?.uei) === targetUei);
      if (exact.length) return { matchedBy:'UEI', records:exact };
    }
    if (targetName) {
      const exact = rows.filter(row => norm(row?.legalBusinessName) === targetName);
      if (exact.length) return { matchedBy:'LEGAL_NAME', records:exact };
    }
    return { matchedBy:null, records:[] };
  }

  normalizedRecords(rows, sourceStatus) {
    return rows.map(row => ({
      authority:'GSA eLibrary',
      sourceUrl:row.sourceUrl || this.live.eLibraryUrl || GsaHolderSnapshotService.ELIBRARY_MAS_CSV,
      contractNumber:row.contractNumber || null,
      legalBusinessName:row.legalBusinessName || null,
      uei:row.uei || null,
      closedForNewAwards:row.closedForNewAwards || null,
      city:row.city || null,
      state:row.state || null,
      website:row.website || null,
      currentOptionPeriodEndDate:row.currentOptionPeriodEndDate || null,
      ultimateContractEndDate:row.ultimateContractEndDate || row.expirationDate || null,
      socioEconomicIndicators:row.socioEconomicIndicators || null,
      categories:Array.isArray(row.categories) ? row.categories : [],
      contractTerm:row.contractTerm || null,
      sourceStatus
    }));
  }

  async liveLookup(uei, companyName) {
    const response = await this.live.requestText(this.live.eLibraryUrl);
    const parsed = this.live.parseELibrary(response.text);
    const match = this.matchRows(parsed.contracts || [], uei, companyName);
    return {
      ok:true,
      status:match.records.length ? 'CURRENT_GSA_MAS_HOLDER_CONFIRMED' : 'CURRENT_GSA_MAS_NON_HOLDER_CONFIRMED',
      generatedAt:new Date().toISOString(),
      holder:match.records.length > 0,
      matchedBy:match.matchedBy,
      records:this.normalizedRecords(match.records, 'LIVE_GSA_ELIBRARY'),
      source:{ authority:'GSA eLibrary', url:this.live.eLibraryUrl, sourceDate:response.sourceDate || null, retrievedAt:new Date().toISOString(), fresh:true, currentHolderAuthority:true },
      limitations:[],
      safety:{ readOnly:true, officialPublicSourceRead:true, productionDatabaseModified:false }
    };
  }

  async stagedLookup(uei, companyName) {
    const executionPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'gsa_execution', 'latest_gsa_data_execution.json');
    const execution = readJson(executionPath);
    const generatedAt = execution?.completedAt || execution?.results?.gsaHolderRefresh?.generatedAt || null;
    const nowMs = (this.now || new Date()).getTime();
    const age = ageHours(generatedAt, nowMs);
    if (!execution || age == null || age < 0 || age > this.maxStagingAgeHours) {
      return { ok:false, status:'CURRENT_GSA_STAGING_UNAVAILABLE_OR_STALE', generatedAt:new Date().toISOString(), holder:null, records:[], source:{ executionPath, generatedAt, ageHours:age, maxAgeHours:this.maxStagingAgeHours, fresh:false } };
    }
    const manifestPath = execution?.outputPaths?.holderManifest || execution?.results?.gsaHolderRefresh?.manifestPath || null;
    const manifest = manifestPath ? readJson(manifestPath) : null;
    const holderArtifact = (manifest?.artifacts || []).find(a => /gsa_current_mas_holders\.jsonl$/i.test(path.basename(a?.filePath || '')));
    const holderPath = holderArtifact?.filePath || null;
    if (!holderPath || !fs.existsSync(holderPath)) {
      return { ok:false, status:'CURRENT_GSA_HOLDER_ARTIFACT_UNAVAILABLE', generatedAt:new Date().toISOString(), holder:null, records:[], source:{ executionPath, manifestPath, holderPath, generatedAt, ageHours:age, fresh:true } };
    }
    const rows = await findJsonl(holderPath, row => {
      const targetUei = norm(uei), targetName = norm(companyName);
      return (targetUei && norm(row?.uei) === targetUei) || (!targetUei && targetName && norm(row?.legalBusinessName) === targetName);
    });
    const match = this.matchRows(rows, uei, companyName);
    return {
      ok:true,
      status:match.records.length ? 'CURRENT_GSA_MAS_HOLDER_CONFIRMED_FROM_FRESH_STAGING' : 'CURRENT_GSA_MAS_NON_HOLDER_CONFIRMED_FROM_FRESH_STAGING',
      generatedAt:new Date().toISOString(),
      holder:match.records.length > 0,
      matchedBy:match.matchedBy,
      records:this.normalizedRecords(match.records, 'FRESH_GSA_ELIBRARY_STAGING'),
      source:{ authority:'GSA eLibrary staged snapshot', executionPath, manifestPath, holderPath, generatedAt, ageHours:age, maxAgeHours:this.maxStagingAgeHours, fresh:true, currentHolderAuthority:true },
      limitations:['Live GSA eLibrary read was unavailable; fresh governed eLibrary staging evidence was used.'],
      safety:{ readOnly:true, officialPublicSourceRead:false, productionDatabaseModified:false }
    };
  }

  async lookup(uei, companyName) {
    let liveError = null;
    if (this.allowLive) {
      try { return await this.liveLookup(uei, companyName); }
      catch (error) { liveError = String(error?.message || error); }
    }
    const staged = await this.stagedLookup(uei, companyName);
    if (staged.ok) {
      staged.limitations = [...(staged.limitations || []), ...(liveError ? [`Live GSA eLibrary lookup failed: ${liveError}`] : [])];
      return staged;
    }
    return {
      ok:false,
      status:'CURRENT_GSA_HOLDER_TRUTH_UNAVAILABLE',
      generatedAt:new Date().toISOString(),
      holder:null,
      matchedBy:null,
      records:[],
      source:staged.source || null,
      limitations:[...(liveError ? [`Live GSA eLibrary lookup failed: ${liveError}`] : []), staged.status],
      safety:{ readOnly:true, productionDatabaseModified:false }
    };
  }
}

module.exports = CurrentGsaHolderTruthService;
module.exports.findJsonl = findJsonl;
