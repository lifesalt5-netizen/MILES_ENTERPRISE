'use strict';

const axios = require('axios');

function clean(v) { return String(v == null ? '' : v).trim(); }
function list(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
function uniq(v) { return [...new Set((v || []).map(clean).filter(Boolean))]; }
function mmddyyyy(d) { return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`; }
function daysAgo(days) { const d = new Date(); d.setUTCDate(d.getUTCDate() - days); return d; }
function dateOnly(v) { const d = new Date(v || 0); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0,10); }

const PTYPE_LABEL = Object.freeze({
  u:'Justification', p:'Presolicitation', a:'Award Notice', r:'Sources Sought', s:'Special Notice',
  o:'Solicitation', g:'Sale of Surplus Property', k:'Combined Synopsis/Solicitation', i:'Intent to Bundle Requirements'
});

function responseDeadline(row) {
  return row.responseDeadLine || row.responseDeadline || row.response_deadline || row.archiveDate || null;
}
function naicsOf(row) {
  return clean(row.naicsCode || row.naics || row.ncode || row.classificationCode);
}
function agencyOf(row) {
  return clean(row.fullParentPathName || row.department || row.subTier || row.office);
}
function typeCodeOf(row) {
  const raw = clean(row.type || row.ptype || row.procurementType || row.noticeType).toLowerCase();
  if (raw.length === 1 && PTYPE_LABEL[raw]) return raw;
  const text = raw.toUpperCase();
  if (text.includes('SOURCE')) return 'r';
  if (text.includes('PRESOL')) return 'p';
  if (text.includes('AWARD')) return 'a';
  if (text.includes('SPECIAL')) return 's';
  if (text.includes('COMBINED')) return 'k';
  if (text.includes('SOLICIT')) return 'o';
  return raw;
}
function stillUseful(row, now = new Date()) {
  const type = typeCodeOf(row);
  if (['p','r','s','i'].includes(type)) return true;
  const deadline = responseDeadline(row);
  if (!deadline) return type !== 'a';
  const d = new Date(deadline);
  return Number.isNaN(d.getTime()) ? true : d >= now;
}
function score(row, profile = {}, buyerAgencies = []) {
  let value = 45;
  const naics = naicsOf(row);
  if (naics && list(profile.naicsCodes).map(clean).includes(naics)) value += 30;
  const agency = agencyOf(row).toUpperCase();
  if (agency && buyerAgencies.some(x => agency.includes(clean(x).toUpperCase()) || clean(x).toUpperCase().includes(agency))) value += 15;
  if (responseDeadline(row)) value += 5;
  if (row.resourceLinks?.length) value += 5;
  return Math.min(100, value);
}

class DemoSamLiveOpportunityService {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.baseUrl = options.baseUrl || 'https://api.sam.gov/opportunities/v2/search';
    this.timeoutMs = Number(options.timeoutMs || process.env.MILES_DEMO_SAM_TIMEOUT_MS || 20000);
    this.maxNaics = Math.max(1, Math.min(Number(options.maxNaics || process.env.MILES_DEMO_SAM_MAX_NAICS || 6), 12));
    this.limitPerNaics = Math.max(1, Math.min(Number(options.limitPerNaics || process.env.MILES_DEMO_SAM_LIMIT_PER_NAICS || 100), 1000));
    this.lookbackDays = Math.max(7, Math.min(Number(options.lookbackDays || process.env.MILES_DEMO_SAM_LOOKBACK_DAYS || 365), 365));
  }

  apiKey() { return clean(process.env.SAM_API_KEY || process.env.SAM_GOV_API_KEY); }

  async fetchForCompany(profile = {}, options = {}) {
    const key = this.apiKey();
    const naicsCodes = uniq(list(profile.naicsCodes)).slice(0, this.maxNaics);
    const generatedAt = new Date().toISOString();
    if (!key) {
      return {
        ok:false,
        status:'SAM_PUBLIC_API_KEY_NOT_AVAILABLE',
        generatedAt,
        records:[],
        sourceCoverage:{ source:'SAM.gov Opportunities Public API', access:'OFFICIAL_API_KEY_REQUIRED', connected:false, freshnessAt:null }
      };
    }
    if (!naicsCodes.length) {
      return {
        ok:false,
        status:'NO_COMPANY_NAICS_FOR_SAM_QUERY',
        generatedAt,
        records:[],
        sourceCoverage:{ source:'SAM.gov Opportunities Public API', access:'CONNECTED_NO_QUERY_BASIS', connected:true, freshnessAt:generatedAt }
      };
    }

    const postedFrom = mmddyyyy(daysAgo(this.lookbackDays));
    const postedTo = mmddyyyy(new Date());
    const buyerAgencies = list(options.buyerAgencies);
    const records = [];
    const errors = [];

    for (const ncode of naicsCodes) {
      try {
        const response = await this.http.get(this.baseUrl, {
          timeout:this.timeoutMs,
          maxRedirects:5,
          params:{ api_key:key, postedFrom, postedTo, ncode, limit:this.limitPerNaics, offset:0 },
          validateStatus:s => s >= 200 && s < 300
        });
        for (const row of list(response?.data?.opportunitiesData)) {
          const ptype = typeCodeOf(row);
          const awardNotice = ptype === 'a';
          if (!awardNotice && !stillUseful(row)) continue;
          records.push({
            id:row.noticeId || row.solicitationNumber || null,
            market:'FEDERAL',
            title:row.title || 'SAM.gov opportunity',
            agency:agencyOf(row) || null,
            office:row.office || null,
            naics:naicsOf(row) || ncode,
            ptype,
            noticeType:PTYPE_LABEL[ptype] || row.type || null,
            postedDate:dateOnly(row.postedDate),
            dueDate:dateOnly(responseDeadline(row)),
            source:'SAM.gov Opportunities Public API',
            sourceUrl:row.uiLink || row.additionalInfoLink || null,
            sourceAccess:'OFFICIAL_PUBLIC_API',
            qualification:`Matched company NAICS ${ncode}${buyerAgencies.length ? '; agency history considered in fit score' : ''}`,
            fitScore:score(row, profile, buyerAgencies),
            confidence:'AUTHORITATIVE_SAM_NOTICE',
            freshnessAt:generatedAt,
            resourceLinks:list(row.resourceLinks)
          });
        }
      } catch (error) {
        errors.push({ ncode, status:error?.response?.status || null, error:error.message });
      }
    }

    const dedupe = new Map();
    for (const row of records) {
      const id = clean(row.id) || `${clean(row.title).toUpperCase()}|${clean(row.agency).toUpperCase()}|${row.postedDate || ''}`;
      const existing = dedupe.get(id);
      if (!existing || Number(row.fitScore || 0) > Number(existing.fitScore || 0)) dedupe.set(id,row);
    }
    const output = [...dedupe.values()].sort((a,b) => Number(b.fitScore || 0) - Number(a.fitScore || 0));
    return {
      ok:errors.length < naicsCodes.length,
      status:errors.length ? (output.length ? 'SAM_LIVE_PARTIAL' : 'SAM_LIVE_LOOKUP_FAILED') : 'SAM_LIVE_CURRENT',
      generatedAt,
      queriedNaics:naicsCodes,
      records:output,
      errors,
      sourceCoverage:{
        source:'SAM.gov Opportunities Public API',
        access:'OFFICIAL_PUBLIC_API_KEY',
        connected:errors.length < naicsCodes.length,
        freshnessAt:generatedAt,
        postedFrom,
        postedTo,
        recordCount:output.length
      }
    };
  }
}

module.exports = DemoSamLiveOpportunityService;
