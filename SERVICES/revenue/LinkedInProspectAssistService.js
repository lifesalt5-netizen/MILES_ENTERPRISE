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
function leadEmail(item = {}) {
  for (const value of [item.email,item.contact_email,item.contact,item.lead_email,item.lead]) {
    const email = extractEmail(value);
    if (email) return email;
  }
  return '';
}
function first(...values) { for (const value of values) if (clean(value)) return clean(value); return ''; }
function parseVars(item = {}) {
  const candidates = [
    item.custom_variables,
    item.customVariables,
    item.variables,
    item.personalization,
    item.payload?.custom_variables,
    item.payload?.customVariables
  ];
  for (const raw of candidates) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {}
    }
  }
  return {};
}
function items(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['items','data','leads','records','results']) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com','googlemail.com','yahoo.com','ymail.com','hotmail.com','outlook.com','live.com',
  'msn.com','aol.com','icloud.com','me.com','mac.com','proton.me','protonmail.com',
  'comcast.net','verizon.net','att.net','sbcglobal.net','cox.net','charter.net','earthlink.net',
  'rr.com','nc.rr.com'
]);
function isPublicEmailDomain(domain = '') {
  const d = lower(domain);
  if (!d) return true;
  if (PUBLIC_EMAIL_DOMAINS.has(d)) return true;
  return [...PUBLIC_EMAIL_DOMAINS].some(x => d.endsWith(`.${x}`));
}
function publicSearchUrl(query) { return query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : ''; }
function profileSearchQuery(p = {}) {
  const who = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  const company = clean(p.companyName);
  const domain = !isPublicEmailDomain(p.domain) ? clean(p.domain) : '';
  if (!who && !company && !domain) return '';
  const terms = [];
  if (who) terms.push(`"${who}"`);
  if (company) terms.push(`"${company}"`);
  else if (domain) terms.push(`"${domain}"`);
  return `site:linkedin.com/in ${terms.join(' ')}`.trim();
}
function companySearchQuery(p = {}) {
  const company = clean(p.companyName);
  const domain = !isPublicEmailDomain(p.domain) ? clean(p.domain) : '';
  if (!company && !domain) return '';
  return `site:linkedin.com/company ${company ? `"${company}"` : `"${domain}"`}`.trim();
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
  if (p.domain && !isPublicEmailDomain(p.domain)) { score += 5; evidence.push('CORPORATE_DOMAIN'); }
  if (p.title) { score += 5; evidence.push('TITLE'); }
  if (p.instantlyLeadMatched) { score += 5; evidence.push('INSTANTLY_LEAD_MATCH'); }
  return { score: Math.min(score, 100), evidence };
}
function identityStatus(p = {}) {
  if (clean(p.linkedinProfileUrl)) return 'EXPLICIT_LINKEDIN_PROFILE';
  if (clean(p.firstName) || clean(p.lastName) || clean(p.companyName) || (clean(p.domain) && !isPublicEmailDomain(p.domain))) {
    return 'PUBLIC_SEARCHABLE_IDENTITY';
  }
  return 'INSUFFICIENT_IDENTITY';
}

class LinkedInProspectAssistService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.lookbackDays = Math.min(Math.max(Number(options.lookbackDays || process.env.P2GC_LINKEDIN_ASSIST_LOOKBACK_DAYS || 14), 1), 90);
    this.maxPages = Math.min(Math.max(Number(options.maxPages || process.env.P2GC_LINKEDIN_ASSIST_MAX_PAGES || 5), 1), 20);
    this.maxLeadPagesPerCampaign = Math.min(Math.max(Number(options.maxLeadPagesPerCampaign || process.env.P2GC_LINKEDIN_ASSIST_MAX_LEAD_PAGES || 20), 1), 100);
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
    return {
      async listEmails(params) { return instantly.request('/emails', { method: 'GET', params }); },
      async listLeads(filters) { return instantly.listLeads(filters); }
    };
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
      const email = lower(row.email || row.contactEmail || row.contact?.email);
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
      const batch = items(response);
      all.push(...batch);
      pages += 1;
      startingAfter = response?.next_starting_after || response?.nextStartingAfter || null;
      if (!startingAfter || !batch.length) break;
    } while (pages < this.maxPages);
    return { items: all, pages, minTimestamp, truncated: Boolean(startingAfter) };
  }

  async loadLeadEnrichment(sentItems = []) {
    const source = this.getInstantlySource();
    if (!source || typeof source.listLeads !== 'function') {
      return { byEmail: new Map(), campaignsObserved: 0, campaignsQueried: 0, leadRecordsLoaded: 0, errors: [{ reason: 'LIST_LEADS_UNAVAILABLE' }] };
    }

    const campaigns = [...new Set(sentItems.map(x => first(x.campaign_id, x.campaignId)).filter(Boolean))];
    const targetEmails = new Set(sentItems.map(recipient).filter(Boolean));
    const byEmail = new Map();
    const errors = [];
    let leadRecordsLoaded = 0;
    let campaignsQueried = 0;

    for (const campaign of campaigns) {
      let startingAfter = null;
      const seenCursors = new Set();
      campaignsQueried += 1;

      try {
        for (let page = 0; page < this.maxLeadPagesPerCampaign; page += 1) {
          const filters = { campaign, limit: 100, distinct_contacts: true };
          if (startingAfter) filters.starting_after = startingAfter;
          const response = await source.listLeads(filters);
          const batch = items(response);
          leadRecordsLoaded += batch.length;

          for (const lead of batch) {
            const email = leadEmail(lead);
            if (email && targetEmails.has(email) && !byEmail.has(email)) byEmail.set(email, lead);
          }

          if (byEmail.size >= targetEmails.size) break;
          const next = response?.next_starting_after || response?.nextStartingAfter || null;
          if (!next || !batch.length) break;

          const lastEmail = leadEmail(batch[batch.length - 1]);
          startingAfter = lastEmail || next;
          if (seenCursors.has(startingAfter)) break;
          seenCursors.add(startingAfter);
        }
      } catch (error) {
        errors.push({ campaign, error: error.message });
      }
    }

    return {
      byEmail,
      campaignsObserved: campaigns.length,
      campaignsQueried,
      leadRecordsLoaded,
      matchedProspects: byEmail.size,
      errors
    };
  }

  normalize(item, crm = {}, lead = {}) {
    const vars = parseVars(item);
    const leadVars = parseVars(lead);
    const email = recipient(item) || leadEmail(lead);
    const domain = email.includes('@') ? email.split('@')[1] : '';
    const firstName = first(
      vars.first_name, vars.firstName, item.first_name, item.firstName,
      leadVars.first_name, leadVars.firstName, lead.first_name, lead.firstName,
      crm.firstName, crm.first_name, crm.contact?.firstName
    );
    const lastName = first(
      vars.last_name, vars.lastName, item.last_name, item.lastName,
      leadVars.last_name, leadVars.lastName, lead.last_name, lead.lastName,
      crm.lastName, crm.last_name, crm.contact?.lastName
    );
    const companyName = first(
      vars.company_name, vars.companyName, item.company_name, item.companyName,
      leadVars.company_name, leadVars.companyName, lead.company_name, lead.companyName,
      lead.company, crm.companyName, crm.legalName, crm.company?.name
    );
    const title = first(
      vars.title, vars.job_title, item.title,
      leadVars.title, leadVars.job_title, lead.title, lead.job_title,
      crm.title, crm.jobTitle, crm.contact?.title
    );
    const linkedinProfileUrl = first(
      vars.linkedin_url, vars.linkedinProfileUrl, item.linkedin_url, item.linkedinProfileUrl,
      leadVars.linkedin_url, leadVars.linkedinProfileUrl, lead.linkedin_url, lead.linkedinProfileUrl,
      crm.linkedinUrl, crm.linkedinProfileUrl, crm.contact?.linkedinUrl
    );
    const linkedinCompanyUrl = first(
      vars.linkedin_company_url, vars.linkedinCompanyUrl, item.linkedin_company_url,
      leadVars.linkedin_company_url, leadVars.linkedinCompanyUrl, lead.linkedin_company_url,
      crm.linkedinCompanyUrl
    );
    const reason = first(
      vars.verified_condition, vars.supporting_verified_fact, vars.verified_recompete_or_vehicle_signal,
      leadVars.verified_condition, leadVars.supporting_verified_fact, leadVars.verified_recompete_or_vehicle_signal,
      crm.serviceFit, crm.notes
    );

    const base = {
      email, domain, firstName, lastName, companyName, title,
      linkedinProfileUrl, linkedinCompanyUrl, reason,
      instantlyLeadMatched: Boolean(lead && Object.keys(lead).length)
    };
    const status = identityStatus(base);
    const match = scoreMatch(base);
    const pQuery = status === 'INSUFFICIENT_IDENTITY' ? '' : profileSearchQuery(base);
    const cQuery = companySearchQuery(base);
    const recommendedAction = linkedinProfileUrl
      ? 'OPEN_PROFILE_AND_CONNECT_MANUALLY'
      : status === 'PUBLIC_SEARCHABLE_IDENTITY'
        ? 'PUBLIC_WEB_PROFILE_SEARCH'
        : 'IDENTITY_ENRICHMENT_REQUIRED';

    return {
      ...base,
      identityStatus: status,
      campaignId: first(item.campaign_id, item.campaignId, lead.campaign, lead.campaign_id, crm.campaignId),
      leadId: first(item.lead_id, item.leadId, lead.id, lead.lead_id, crm.leadId),
      crmStage: first(crm.stage),
      lastEmailAt: first(item.timestamp_email, item.timestamp_created, item.created_at),
      profileMatchScore: match.score,
      profileMatchEvidence: match.evidence,
      profileSearchQuery: pQuery,
      profileSearchUrl: publicSearchUrl(pQuery),
      companySearchQuery: cQuery,
      companySearchUrl: publicSearchUrl(cQuery),
      recommendedAction,
      connectionNote: draftNote(base),
      manualActionRequired: true,
      linkedinMutationAllowed: false
    };
  }

  renderHtml(report) {
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const rows = report.prospects.map((p, i) => {
      const profileCell = p.linkedinProfileUrl
        ? `<a href="${esc(p.linkedinProfileUrl)}">Open profile</a>`
        : p.profileSearchUrl
          ? `<a href="${esc(p.profileSearchUrl)}">Find profile</a>`
          : 'Identity enrichment required';
      const companyCell = p.companySearchUrl ? `<a href="${esc(p.companySearchUrl)}">Company search</a>` : '';
      return `<tr><td>${i+1}</td><td>${esc(p.companyName)}</td><td>${esc([p.firstName,p.lastName].filter(Boolean).join(' '))}</td><td>${esc(p.email)}</td><td>${esc(p.crmStage)}</td><td>${esc(p.identityStatus)}</td><td>${esc(p.profileMatchScore)}</td><td>${profileCell}</td><td>${companyCell}</td><td>${esc(p.connectionNote)}</td></tr>`;
    }).join('\n');

    return `<!doctype html><html><head><meta charset="utf-8"><title>P2GC LinkedIn Prospect Assist</title><style>body{font-family:Arial,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;vertical-align:top}th{background:#f4f4f4}.summary{margin:12px 0 20px}</style></head><body><h1>P2GC LinkedIn Prospect Assist</h1><p><strong>Assisted mode only.</strong> MILES enriches recent Instantly prospects with Instantly lead/CRM identity, creates public profile-search paths, and drafts notes. It does not scrape LinkedIn, send invitations, or send DMs.</p><div class="summary">Generated ${esc(report.generatedAt)} | prospects ${report.prospectCount} | Instantly lead matches ${report.instantlyLeadMatched} | explicit profiles ${report.explicitLinkedInProfiles} | searchable ${report.publicSearchRequired} | identity gaps ${report.insufficientIdentity}</div><table><thead><tr><th>#</th><th>Company</th><th>Contact</th><th>Email</th><th>CRM Stage</th><th>Identity</th><th>Score</th><th>LinkedIn</th><th>Company</th><th>Suggested note</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  }

  async run() {
    const crm = this.loadCrm();
    const crmMap = this.crmByEmail(crm);
    const sent = await this.loadSentEmails();
    const leadEnrichment = await this.loadLeadEnrichment(sent.items);
    const byEmail = new Map();

    for (const item of sent.items) {
      const email = recipient(item);
      if (!email || byEmail.has(email)) continue;
      byEmail.set(email, this.normalize(item, crmMap.get(email) || {}, leadEnrichment.byEmail.get(email) || {}));
      if (byEmail.size >= this.maxProspects) break;
    }

    const prospects = [...byEmail.values()].sort((a,b) =>
      Number(Boolean(b.linkedinProfileUrl)) - Number(Boolean(a.linkedinProfileUrl)) ||
      Number(b.identityStatus === 'PUBLIC_SEARCHABLE_IDENTITY') - Number(a.identityStatus === 'PUBLIC_SEARCHABLE_IDENTITY') ||
      Number(b.profileMatchScore || 0) - Number(a.profileMatchScore || 0) ||
      (Date.parse(b.lastEmailAt || 0) - Date.parse(a.lastEmailAt || 0))
    );

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
      instantlyLeadMatched: prospects.filter(x => x.instantlyLeadMatched).length,
      leadEnrichment: {
        campaignsObserved: leadEnrichment.campaignsObserved,
        campaignsQueried: leadEnrichment.campaignsQueried,
        leadRecordsLoaded: leadEnrichment.leadRecordsLoaded,
        matchedProspects: leadEnrichment.matchedProspects,
        errors: leadEnrichment.errors
      },
      explicitLinkedInProfiles: prospects.filter(x => x.linkedinProfileUrl).length,
      publicSearchRequired: prospects.filter(x => !x.linkedinProfileUrl && x.identityStatus === 'PUBLIC_SEARCHABLE_IDENTITY').length,
      insufficientIdentity: prospects.filter(x => x.identityStatus === 'INSUFFICIENT_IDENTITY').length,
      prospects,
      safety: {
        linkedinScraping: false,
        automatedConnectionRequests: false,
        automatedDirectMessages: false,
        publicWebSearchLinksOnly: true,
        manualLinkedInActionRequired: true,
        stopOnEmailReplyShouldBeEnforcedByCRM: true,
        consumerDomainOnlySearchSuppressedWithoutIdentity: true
      }
    };

    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(this.latestPath, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(this.htmlPath, this.renderHtml(report), 'utf8');
    return { ...report, outputFile: this.latestPath, htmlFile: this.htmlPath };
  }
}

module.exports = LinkedInProspectAssistService;
module.exports.helpers = {
  extractEmail, recipient, leadEmail, profileSearchQuery, companySearchQuery,
  publicSearchUrl, draftNote, scoreMatch, identityStatus, isPublicEmailDomain
};
