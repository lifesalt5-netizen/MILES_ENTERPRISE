'use strict';

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

function clean(v) { return String(v == null ? '' : v).trim(); }
function norm(v) { return clean(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function header(v) { return clean(v).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function list(v) { return Array.isArray(v) ? v.filter(Boolean) : (v == null || v === '' ? [] : [v]); }
function dateOnly(v) { const d = new Date(v || 0); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } }
function first(row, names) { for (const name of names) { const value = row?.[header(name)]; if (value != null && clean(value) !== '') return value; } return null; }
function number(v) { const n = Number(String(v ?? '').replace(/[$,]/g, '').trim()); return Number.isFinite(n) ? n : null; }
function boolish(v) {
  const value = clean(v).toLowerCase();
  if (!value) return null;
  if (['true','1','yes','y','active'].includes(value)) return true;
  if (['false','0','no','n','inactive','archived'].includes(value)) return false;
  return null;
}
function stageOf(row) {
  const code = clean(first(row, ['type','noticeTypeCode','notice_type_code'])).toLowerCase();
  const text = norm([first(row,['type','baseType','archiveType','noticeType']), first(row,['title'])].filter(Boolean).join(' '));
  if (code === 'r' || /SOURCES SOUGHT|SOURCE SOUGHT/.test(text)) return 'SOURCES_SOUGHT';
  if (/\bRFI\b|REQUEST FOR INFORMATION/.test(text)) return 'RFI';
  if (code === 'p' || /PRESOLICIT|PRE SOLICIT/.test(text)) return 'PRESOLICITATION';
  if (/DRAFT RFP|DRAFT RFQ|DRAFT SOLICIT|DRAFT REQUEST/.test(text)) return 'DRAFT';
  if (/FORECAST|PROCUREMENT PLAN|ACQUISITION PLAN/.test(text)) return 'FORECAST';
  if (code === 's' || /SPECIAL NOTICE/.test(text)) return 'SPECIAL_NOTICE';
  if (code === 'o' || code === 'k' || /SOLICITATION|REQUEST FOR PROPOSAL|\bRFP\b|REQUEST FOR QUOTE|\bRFQ\b|INVITATION FOR BID|\bIFB\b/.test(text)) return 'OPEN';
  return 'UNKNOWN';
}
function sourceUrl(row, noticeId) {
  const direct = first(row, ['uiLink','link','url','additionalInfoLink']);
  if (direct) return clean(direct);
  return noticeId ? `https://sam.gov/opp/${encodeURIComponent(clean(noticeId))}/view` : 'https://sam.gov/content/opportunities';
}
function sourceFileFromReport(rootDir) {
  const reportPath = path.join(rootDir, 'DATA', 'orion_refresh', 'latest_sam_bulk_acquisition.json');
  const report = readJson(reportPath);
  const entry = list(report?.files).find(x => x?.role === 'contract_opportunities' || /ContractOpportunitiesFullCSV\.csv$/i.test(clean(x?.fileName || x?.path)));
  return {
    reportPath,
    report,
    generatedAt: report?.generatedAt || null,
    file: entry?.path || null,
    sourceUrl: entry?.sourceUrl || 'https://sam.gov/data-services/Contract%20Opportunities/datagov?privacy=Public'
  };
}
function ageHours(iso, nowMs = Date.now()) { const ms = Date.parse(iso || ''); return Number.isFinite(ms) ? (nowMs - ms) / 3600000 : null; }
function tokenizeSetAside(v) { return norm(v).split(' ').filter(Boolean); }
function compatibleSetAside(text, profile) {
  const t = norm(text);
  if (!t) return { score:0, reason:null };
  const certs = norm(list(profile?.certifications).join(' '));
  if (/TOTAL SMALL BUSINESS|SMALL BUSINESS SET ASIDE|SMALL BUSINESS/.test(t)) return { score:8, reason:'Small-business set-aside signal' };
  const checks = [
    ['WOSB', /WOMEN OWNED SMALL BUSINESS|\bWOSB\b/],
    ['EDWOSB', /ECONOMICALLY DISADVANTAGED WOMEN OWNED|\bEDWOSB\b/],
    ['SDVOSB', /SERVICE DISABLED VETERAN|\bSDVOSB\b/],
    ['8(A)', /\b8 A\b|8\(A\)/],
    ['HUBZONE', /HUBZONE/]
  ];
  for (const [cert, re] of checks) {
    if (re.test(t)) return certs.includes(cert) ? { score:12, reason:`${cert} set-aside aligns with identified certification` } : { score:-18, reason:`${cert} set-aside requires certification validation` };
  }
  return { score:0, reason:`Set-aside: ${clean(text)}` };
}

let sourceIndexCache = null;
let sourceIndexBuild = null;

function sourceFingerprint(source) {
  const stat = fs.statSync(source.file);
  return `${path.resolve(source.file)}|${source.generatedAt || ''}|${stat.size}|${Math.round(stat.mtimeMs)}`;
}

function compactIndexRow(row, naics) {
  const active = boolish(first(row,['active','isActive']));
  if (active === false) return null;
  const title = clean(first(row,['title','opportunityTitle','solicitationTitle']));
  if (!title) return null;
  const noticeId = first(row,['noticeId','id']);
  return {
    active,
    title,
    noticeId:noticeId || null,
    solicitationNumber:first(row,['solicitationNumber','solicitation','sol']) || null,
    stage:stageOf(row),
    agency:first(row,['departmentIndAgency','department','agency']) || null,
    office:first(row,['office','subTier','subtier']) || null,
    naics,
    psc:first(row,['classificationCode','psc','pscCode']) || null,
    setAside:first(row,['setAside','setAsideDescription','typeOfSetAsideDescription']) || null,
    postedDate:dateOnly(first(row,['postedDate','publishDate'])),
    dueDate:dateOnly(first(row,['responseDeadLine','responseDeadline','dueDate','closeDate'])),
    archiveDate:dateOnly(first(row,['archiveDate'])),
    estimatedValue:number(first(row,['awardAmount','awardValue','estimatedValue'])),
    sourceUrl:sourceUrl(row, noticeId)
  };
}

async function buildSourceIndex(source) {
  const fingerprint = sourceFingerprint(source);
  const byNaics = new Map();
  const allCountsByNaics = new Map();
  let scanned = 0;
  await new Promise((resolve, reject) => {
    fs.createReadStream(source.file)
      .pipe(csv({ mapHeaders: ({ header: h }) => header(h) }))
      .on('data', row => {
        scanned += 1;
        const naics = clean(first(row, ['naicsCode','naics','primaryNaics'])).replace(/\D/g,'');
        if (naics.length < 5) return;
        allCountsByNaics.set(naics, Number(allCountsByNaics.get(naics) || 0) + 1);
        const compact = compactIndexRow(row, naics);
        if (!compact) return;
        const bucket = byNaics.get(naics) || [];
        bucket.push(compact);
        byNaics.set(naics, bucket);
      })
      .on('error', reject)
      .on('end', resolve);
  });
  return {
    fingerprint,
    file:source.file,
    generatedAt:source.generatedAt || null,
    builtAt:new Date().toISOString(),
    scanned,
    indexedNaicsCount:byNaics.size,
    indexedRowCount:[...byNaics.values()].reduce((sum, rows) => sum + rows.length, 0),
    allCountsByNaics,
    byNaics
  };
}

async function getSourceIndex(source) {
  const fingerprint = sourceFingerprint(source);
  if (sourceIndexCache?.fingerprint === fingerprint) return { index:sourceIndexCache, cacheHit:true, sharedBuild:false };
  if (sourceIndexBuild?.fingerprint === fingerprint) {
    const index = await sourceIndexBuild.promise;
    return { index, cacheHit:true, sharedBuild:true };
  }
  const promise = buildSourceIndex(source).then(index => {
    sourceIndexCache = index;
    return index;
  }).finally(() => {
    if (sourceIndexBuild?.fingerprint === fingerprint) sourceIndexBuild = null;
  });
  sourceIndexBuild = { fingerprint, promise };
  return { index:await promise, cacheHit:false, sharedBuild:false };
}

function clearSourceIndexCache() {
  sourceIndexCache = null;
  sourceIndexBuild = null;
}

class CurrentPublicOpportunityMatchService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.maxAgeHours = Math.max(1, Number(options.maxAgeHours || process.env.MILES_OPPORTUNITY_EVIDENCE_MAX_AGE_HOURS || 48));
    this.now = options.now ? new Date(options.now) : null;
  }

  async match(model = {}, options = {}) {
    const now = options.now ? new Date(options.now) : (this.now || new Date());
    const asOf = now.toISOString().slice(0, 10);
    const source = sourceFileFromReport(this.rootDir);
    const age = ageHours(source.generatedAt, now.getTime());
    const fresh = age != null && age >= 0 && age <= this.maxAgeHours;
    const naicsSet = new Set(list(model?.profile?.naicsCodes).map(x => clean(x).replace(/\D/g,'')).filter(x => x.length >= 5));

    if (!source.report?.ok || !source.file || !fs.existsSync(source.file)) {
      return {
        ok:false,
        status:'CURRENT_PUBLIC_OPPORTUNITY_SOURCE_UNAVAILABLE',
        generatedAt:new Date().toISOString(),
        source:{ authority:'SAM.gov Public Contract Opportunities bulk extract', reportPath:source.reportPath, file:source.file, sourceUrl:source.sourceUrl, fresh:false, ageHours:age },
        records:[],
        blockers:['SAM_PUBLIC_OPPORTUNITY_BULK_EXTRACT_NOT_AVAILABLE'],
        safety:{ readOnly:true, authenticatedScraping:false, loginAutomation:false }
      };
    }
    if (!fresh) {
      return {
        ok:false,
        status:'CURRENT_PUBLIC_OPPORTUNITY_SOURCE_STALE',
        generatedAt:new Date().toISOString(),
        source:{ authority:'SAM.gov Public Contract Opportunities bulk extract', reportPath:source.reportPath, file:source.file, sourceUrl:source.sourceUrl, generatedAt:source.generatedAt, fresh:false, ageHours:age, maxAgeHours:this.maxAgeHours },
        records:[],
        blockers:['SAM_PUBLIC_OPPORTUNITY_BULK_EXTRACT_STALE'],
        safety:{ readOnly:true, authenticatedScraping:false, loginAutomation:false }
      };
    }
    if (!naicsSet.size) {
      return {
        ok:false,
        status:'PROSPECT_NAICS_REQUIRED_FOR_CURRENT_OPPORTUNITY_MATCH',
        generatedAt:new Date().toISOString(),
        source:{ authority:'SAM.gov Public Contract Opportunities bulk extract', file:source.file, sourceUrl:source.sourceUrl, generatedAt:source.generatedAt, fresh:true, ageHours:age },
        records:[],
        blockers:['PROSPECT_NAICS_UNAVAILABLE'],
        safety:{ readOnly:true }
      };
    }

    const limit = Math.max(1, Math.min(Number(options.limit || 30), 100));
    const indexAccess = await getSourceIndex(source);
    const index = indexAccess.index;
    const indexedRows = [...naicsSet].flatMap(naics => index.byNaics.get(naics) || []);
    const naicsMatched = [...naicsSet].reduce((sum, naics) => sum + Number(index.allCountsByNaics.get(naics) || 0), 0);
    const candidates = [];

    for (const row of indexedRows) {
      if (row.dueDate && row.dueDate < asOf) continue;
      if (!row.dueDate && row.archiveDate && row.archiveDate < asOf) continue;
      const setAsideFit = compatibleSetAside(row.setAside, model?.profile || {});
      const reasons = [`Exact prospect NAICS ${row.naics} match`, 'Current public SAM.gov opportunity source'];
      if (setAsideFit.reason) reasons.push(setAsideFit.reason);
      let fitScore = 70 + setAsideFit.score;
      if (row.dueDate) fitScore += 5;
      if (['RFI','SOURCES_SOUGHT','PRESOLICITATION','OPEN'].includes(row.stage)) fitScore += 5;
      fitScore = Math.max(0, Math.min(100, fitScore));
      candidates.push({
        id:row.noticeId || row.solicitationNumber || null,
        noticeId:row.noticeId || null,
        solicitationNumber:row.solicitationNumber || null,
        title:row.title,
        market:'FEDERAL',
        stage:row.stage,
        status:row.active === true ? 'ACTIVE' : 'CURRENT_SOURCE_RECORD',
        agency:row.agency,
        office:row.office,
        naics:row.naics,
        psc:row.psc,
        setAside:row.setAside,
        postedDate:row.postedDate,
        dueDate:row.dueDate,
        estimatedValue:row.estimatedValue,
        source:'SAM.gov Public Contract Opportunities',
        sourceUrl:row.sourceUrl,
        sourceAccess:'PUBLIC',
        qualification:reasons.join('; '),
        fitReasons:reasons,
        fitScore,
        confidence:'CURRENT_PUBLIC_SOURCE_NAICS_ALIGNED_CANDIDATE',
        freshnessAt:source.generatedAt,
        live:true
      });
    }

    const deduped = new Map();
    for (const row of candidates) {
      const key = clean(row.noticeId || row.solicitationNumber) || norm(`${row.agency}|${row.title}|${row.dueDate}`);
      const current = deduped.get(key);
      if (!current || row.fitScore > current.fitScore) deduped.set(key, row);
    }
    const records = [...deduped.values()]
      .sort((a,b) => (b.fitScore-a.fitScore) || clean(a.dueDate || '9999-12-31').localeCompare(clean(b.dueDate || '9999-12-31')))
      .slice(0, limit);

    return {
      ok:true,
      status:records.length ? 'CURRENT_PUBLIC_OPPORTUNITY_CANDIDATES_AVAILABLE' : 'NO_CURRENT_PUBLIC_NAICS_MATCHES_FOUND',
      generatedAt:new Date().toISOString(),
      source:{ authority:'SAM.gov Public Contract Opportunities bulk extract', reportPath:source.reportPath, file:source.file, sourceUrl:source.sourceUrl, generatedAt:source.generatedAt, fresh:true, ageHours:age, maxAgeHours:this.maxAgeHours },
      match:{
        asOfDate:asOf,
        prospectNaics:[...naicsSet],
        rowsScanned:index.scanned,
        exactNaicsRows:naicsMatched,
        candidatesBeforeDedupe:candidates.length,
        returned:records.length,
        sourceIndex:{
          cacheHit:indexAccess.cacheHit,
          sharedBuild:indexAccess.sharedBuild,
          builtAt:index.builtAt,
          indexedNaicsCount:index.indexedNaicsCount,
          indexedRowCount:index.indexedRowCount,
          rule:'The current SAM.gov bulk extract is parsed once per exact source fingerprint and shared in memory across prospect lookups.'
        },
        rule:'Exact prospect NAICS plus freshness, open-date and access checks. This is candidate matching, not automatic bid qualification.'
      },
      records,
      blockers:[],
      safety:{ readOnly:true, authenticatedScraping:false, loginAutomation:false, restrictedPortalAccess:false, sourceIndexInMemoryOnly:true, sourceIndexWrites:false }
    };
  }
}

module.exports = CurrentPublicOpportunityMatchService;
module.exports.stageOf = stageOf;
module.exports.sourceFileFromReport = sourceFileFromReport;
module.exports.compatibleSetAside = compatibleSetAside;
module.exports.sourceFingerprint = sourceFingerprint;
module.exports.buildSourceIndex = buildSourceIndex;
module.exports.getSourceIndex = getSourceIndex;
module.exports.clearSourceIndexCache = clearSourceIndexCache;
