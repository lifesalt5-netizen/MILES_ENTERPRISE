'use strict';

const fs = require('fs');
const path = require('path');

function clean(v) { return String(v || '').trim(); }
function lower(v) { return clean(v).toLowerCase(); }
function extractEmail(value = '') {
  const text = clean(value).toLowerCase();
  const angle = text.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angle) return angle[1];
  const plain = text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return plain ? plain[0].toLowerCase() : '';
}
function recipient(item = {}) {
  for (const value of [item.to_address_email,item.to_email,item.to,item.lead,item.lead_email,item.contact,item.contact_email]) {
    const email = extractEmail(value);
    if (email) return email;
  }
  return '';
}
function first(...values) { for (const value of values) if (clean(value)) return clean(value); return ''; }
function parseVars(item = {}) {
  const raw = item.custom_variables || item.customVariables || item.variables || {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}
function publicSearchUrl(query) { return `https://www.google.com/search?q=${encodeURIComponent(query)}`; }
function profileSearchQuery(p = {}) {
  const who = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  const company = clean(p.companyName);
  return `site:linkedin.com/in ${who ? `"${who}" ` : ''}${company ? `"${company}"` : ''}`.trim();
}
function companySearchQuery(p = {}) {
  const company = clean(p.companyName);
  return `site:linkedin.com/company ${company ? `"${company}"` : p.domain || ''}`.trim();
}
function draftNote(p = {}) {
  const firstName = clean(p.firstName) || 'there';
  const company = clean(p.companyName) || 'your company';
  const reason = clean(p.reason);
  const base = reason
    ? `I sent you a note after reviewing ${company} and ${reason}.`
    : `I sent you a note after reviewing ${company}'s government-contracting position.`;
  return `Hi ${firstName} — ${base} Thought it made sense to connect here as well.`;
}
function scoreMatch(p = {}) {
  let score = 0;
  const evidence = [];
  if (p.linkedinProfileUrl) { score += 70; evidence.push('EXPLICIT_PROFILE_URL'); }
  if (p.firstName || p.lastName) { score += 10; evidence.push('CONTACT_NAME'); }
  if (p.companyName) { score += 10; evidence.push('COMPANY_NAME'); }
  if (p.domain) { score += 5; evidence.push('DOMAIN'); }
  if (p.title) { score += 5; evidence.push('TITLE'); }
  return { score: Math.min(score, 100), evidence };
}

class LinkedInProspectAssistService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.lookbackDays = Math.min(Math.max(Number(options.lookbackDays || process.env.P2GC_LINKEDIN_ASSIST_LOOKBACK_DAYS || 14), 1), 90);
    this.maxPages = Math.min(Math.max(Number(options.maxPages || process.env.P2GC_LINKEDIN_ASSIST_MAX_PAGES || 5), 1), 20);
    this.maxProspects = Math.min(Math.max(Number(options.maxProspects || process.env.P2GC_LINKEDIN_ASSIST_MAX_PROSPECTS || 100), 1), 500);
    this.instantlySource = options.instantlySource || null;
    this.crmPath = options.crmPath || path.join(this.rootDir, 'DATA', 'CRM', 'canonical_crm.json');
    this.outputDir = options.outputDir || path.join(this.rootDir, 'DATA', 'runtime', 'revenue', 'linkedin_prospect_assist');
    this.latestPath = path.join(this.outputDir, 'latest.json');
    this.htmlPath = path.join(this.outputDir, 'latest.html');
  }

  getInstantlySource() {
    if (this.instantlySource) return this.instantlySource;
    const instantly = require(path.join(this.rootDir, 'CONNECTORS', 'INSTANTLY', 'instantly.js'));
    return { async listEmails(params) { return instantly.request('/emails', { method: 'GET', params }); } };
  }

  loadCrm() {
    try {
      const payload = JSON.parse(fs.readFileSync(this.crmPath, 'utf8').replace(/^\uFEFF/, ''));
      return Array.isArray(payload) ? payload : Array.isArray(payload.records) ? payload.records : [];
    } catch { return []; }
  }

  crmByEmail(records) {
    const map = new Map();
    for (const row of records) {
      const email = lower(row.email || row.contactEmail);
      if (email && !map.has(email)) map.set(email, row);
    }
    return map;
  }

  async loadSentEmails() {
    const source = this.getInstantlySource();
    const minTimestamp = new Date(Date.now() - this.lookbackDays * 86400000).toISOString();
    const all = [];
    let startingAfter = null;
    let pages = 0;
    do {
      const params = { limit: 100, email_type: 'sent', min_timestamp_created: minTimestamp };
      if (startingAfter) params.starting_after = startingAfter;
      const response = await source.listEmails(params);
      const items = Array.isArray(response?.items) ? response.items : Array.isArray(response) ? response : [];
      all.push(...items);
      pages += 1;
      startingAfter = response?.next_starting_after || null;
      if (!startingAfter || !items.length) break;
    } while (pages < this.maxPages);
    return { items: all, pages, minTimestamp, truncated: Boolean(startingAfter) };
  }

  normalize(item, crm = {}) {
    const vars = parseVars(item);
    const email = recipient(item);
    const domain = email.includes('@') ? email.split('@')[1] : '';
    const firstName = first(vars.first_name, vars.firstName, item.first_name, item.firstName, crm.firstName, crm.first_name);
    const lastName = first(vars.last_name, vars.lastName, item.last_name, item.lastName, crm.lastName, crm.last_name);
    const companyName = first(vars.company_name, vars.companyName, item.company_name, item.companyName, crm.companyName, crm.legalName);
    const title = first(vars.title, vars.job_title, item.title, crm.title, crm.jobTitle);
    const linkedinProfileUrl = first(vars.linkedin_url, vars.linkedinProfileUrl, item.linkedin_url, item.linkedinProfileUrl, crm.linkedinUrl, crm.linkedinProfileUrl);
    const linkedinCompanyUrl = first(vars.linkedin_company_url, vars.linkedinCompanyUrl, item.linkedin_company_url, crm.linkedinCompanyUrl);
    const reason = first(vars.verified_condition, vars.supporting_verified_fact, vars.verified_recompete_or_vehicle_signal, crm.serviceFit, crm.notes);
    const base = { email, domain, firstName, lastName, companyName, title, linkedinProfileUrl, linkedinCompanyUrl, reason };
    const match = scoreMatch(base);
    const pQuery = profileSearchQuery(base);
    const cQuery = companySearchQuery(base);
    return {
      ...base,
      campaignId: first(item.campaign_id, item.campaignId, crm.campaignId),
      leadId: first(item.lead_id, item.leadId, crm.leadId),
      crmStage: first(crm.stage),
      lastEmailAt: first(item.timestamp_email, item.timestamp_created, item.created_at),
      profileMatchScore: match.score,
      profileMatchEvidence: match.evidence,
      profileSearchQuery: pQuery,
      profileSearchUrl: publicSearchUrl(pQuery),
      companySearchQuery: cQuery,
      companySearchUrl: publicSearchUrl(cQuery),
      recommendedAction: linkedinProfileUrl ? 'OPEN_PROFILE_AND_CONNECT_MANUALLY' : 'PUBLIC_WEB_PROFILE_SEARCH',
      connectionNote: draftNote(base),
      manualActionRequired: true,
      linkedinMutationAllowed: false
    };
  }

  renderHtml(report) {
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const rows = report.prospects.map((p, i) => `<tr><td>${i+1}</td><td>${esc(p.companyName)}</td><td>${esc([p.firstName,p.lastName].filter(Boolean).join(' '))}</td><td>${esc(p.email)}</td><td>${esc(p.crmStage)}</td><td>${p.linkedinProfileUrl ? `<a href="${esc(p.linkedinProfileUrl)}">Open profile</a>` : `<a href="${esc(p.profileSearchUrl)}">Find profile</a>`}</td><td><a href="${esc(p.companySearchUrl)}">Company search</a></td><td>${esc(p.connectionNote)}</td></tr>`).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>P2GC LinkedIn Prospect Assist</title><style>body{font-family:Arial,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;vertical-align:top}th{background:#f4f4f4}</style></head><body><h1>P2GC LinkedIn Prospect Assist</h1><p><strong>Assisted mode only.</strong> MILES organizes public profile search paths and drafts notes; it does not scrape LinkedIn, send invitations, or send DMs.</p><p>Generated ${esc(report.generatedAt)} | prospects ${report.prospectCount}</p><table><thead><tr><th>#</th><th>Company</th><th>Contact</th><th>Email</th><th>CRM Stage</th><th>LinkedIn</th><th>Company</th><th>Suggested note</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  }

  async run() {
    const crm = this.loadCrm();
    const crmMap = this.crmByEmail(crm);
    const sent = await this.loadSentEmails();
    const byEmail = new Map();
    for (const item of sent.items) {
      const email = recipient(item);
      if (!email || byEmail.has(email)) continue;
      byEmail.set(email, this.normalize(item, crmMap.get(email) || {}));
      if (byEmail.size >= this.maxProspects) break;
    }
    const prospects = [...byEmail.values()].sort((a,b) => Number(Boolean(b.linkedinProfileUrl)) - Number(Boolean(a.linkedinProfileUrl)) || (Date.parse(b.lastEmailAt || 0) - Date.parse(a.lastEmailAt || 0)));
    const report = {
      ok: true,
      service: 'P2GC_LINKEDIN_PROSPECT_ASSIST',
      status: prospects.length ? 'ASSIST_QUEUE_READY' : 'NO_RECENT_SENT_PROSPECTS',
      generatedAt: new Date().toISOString(),
      lookbackDays: this.lookbackDays,
      sentMessagesInspected: sent.items.length,
      pages: sent.pages,
      truncated: sent.truncated,
      prospectCount: prospects.length,
      explicitLinkedInProfiles: prospects.filter(x => x.linkedinProfileUrl).length,
      publicSearchRequired: prospects.filter(x => !x.linkedinProfileUrl).length,
      prospects,
      safety: {
        linkedinScraping: false,
        automatedConnectionRequests: false,
        automatedDirectMessages: false,
        publicWebSearchLinksOnly: true,
        manualLinkedInActionRequired: true,
        stopOnEmailReplyShouldBeEnforcedByCRM: true
      }
    };
    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(this.latestPath, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(this.htmlPath, this.renderHtml(report), 'utf8');
    return { ...report, outputFile: this.latestPath, htmlFile: this.htmlPath };
  }
}

module.exports = LinkedInProspectAssistService;
module.exports.helpers = { extractEmail, recipient, profileSearchQuery, companySearchQuery, publicSearchUrl, draftNote, scoreMatch };
