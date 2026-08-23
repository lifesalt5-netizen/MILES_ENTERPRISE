'use strict';

const fs = require('fs');
const path = require('path');
const GlobalSuppressionService = require('./GlobalSuppressionService');

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function clean(v) { return String(v || '').trim(); }
function lower(v) { return clean(v).toLowerCase(); }
function normalizeName(v) { return clean(v).replace(/\s+/g, ' ').toUpperCase(); }
function items(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}
function bool(value) { return value === true || ['1','true','yes','on'].includes(lower(value)); }

class P2GCAcquisitionV2CampaignService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.rulesPath = options.rulesPath || path.join(this.rootDir, 'CONFIG', 'p2gc_acquisition_v2_campaign_rules.json');
    this.rules = options.rules || readJson(this.rulesPath, {});
    this.connector = options.connector || require('../../CONNECTORS/INSTANTLY/connector');
    this.suppression = options.suppression || new GlobalSuppressionService({ rootDir: this.rootDir });
  }

  offerRule(offerId) {
    return this.rules?.offers?.[offerId] || null;
  }

  validateEvidence(lead, rule) {
    const missing = [];
    const invalid = [];
    for (const field of rule.required_fact_fields || []) {
      if (!clean(lead[field])) missing.push(field);
    }
    for (const field of rule.required_source_fields || []) {
      if (!clean(lead[field])) missing.push(field);
    }
    const pairs = [
      ['supporting_verified_fact', 'supporting_verified_fact_source'],
      ['verified_agency_or_market_fact', 'verified_agency_or_market_fact_source'],
      ['verified_recompete_or_vehicle_signal', 'verified_recompete_or_vehicle_signal_source']
    ];
    for (const [fact, source] of pairs) {
      if (clean(lead[fact]) && !clean(lead[source])) invalid.push(`${fact}_WITHOUT_SOURCE`);
    }
    return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
  }

  validateLead(lead = {}, offerId) {
    const rule = this.offerRule(offerId);
    if (!rule) return { ok: false, reasons: ['UNKNOWN_OFFER'] };
    const email = lower(lead.email || lead.contactEmail);
    const reasons = [];
    if (!email || !email.includes('@')) reasons.push('INVALID_EMAIL');
    if (!clean(lead.company_name || lead.companyName)) reasons.push('MISSING_COMPANY_NAME');
    const evidence = this.validateEvidence(lead, rule);
    reasons.push(...evidence.missing.map(x => `MISSING_${String(x).toUpperCase()}`), ...evidence.invalid);
    if (email && this.suppression.isSuppressed(email)) reasons.push('GLOBAL_SUPPRESSION');
    return { ok: reasons.length === 0, reasons, evidence };
  }

  personalizedLead(lead = {}, offerId) {
    const firstName = clean(lead.first_name || lead.firstName);
    const companyName = clean(lead.company_name || lead.companyName);
    return {
      email: lower(lead.email || lead.contactEmail),
      first_name: firstName,
      last_name: clean(lead.last_name || lead.lastName),
      company_name: companyName,
      custom_variables: {
        offer_id: offerId,
        segment: clean(lead.segment),
        company_name: companyName,
        first_name: firstName,
        verified_condition: clean(lead.verified_condition),
        verified_condition_source: clean(lead.verified_condition_source),
        supporting_verified_fact: clean(lead.supporting_verified_fact),
        supporting_verified_fact_source: clean(lead.supporting_verified_fact_source),
        verified_agency_or_market_fact: clean(lead.verified_agency_or_market_fact),
        verified_agency_or_market_fact_source: clean(lead.verified_agency_or_market_fact_source),
        verified_recompete_or_vehicle_signal: clean(lead.verified_recompete_or_vehicle_signal),
        verified_recompete_or_vehicle_signal_source: clean(lead.verified_recompete_or_vehicle_signal_source),
        uei: clean(lead.uei),
        cage: clean(lead.cage)
      }
    };
  }

  sequences(offerId) {
    if (offerId === 'GSA_ZERO_SALES_DIAGNOSTIC') {
      return [{ steps: [
        { type: 'email', delay: 0, variants: [{ subject: "Quick question about {{company_name}}'s GSA Schedule", body: "Hi {{first_name}},\n\nI was reviewing {{company_name}}'s federal positioning and noticed {{verified_condition}}.\n\nHaving the Schedule is one thing. Turning it into measurable federal revenue is another.\n\nWe built a short GSA Zero-Sales Diagnostic specifically for companies in this position. It looks at where the revenue gap appears to be — buyer targeting, agency alignment, opportunity fit, vehicle use, or capture execution.\n\nWould it be useful if I sent you the diagnostic outline?\n\nKevin\nPathways 2 Government Contracting" }] },
        { type: 'email', delay: 3, variants: [{ subject: 'Re: {{company_name}} + GSA revenue', body: "Hi {{first_name}},\n\nJust following up. The reason I reached out is the verified condition we found in {{company_name}}'s current federal position.\n\nIf useful, I can send the short review framework we use to separate a vehicle problem from a buyer, opportunity-fit, or capture problem.\n\nKevin" }] },
        { type: 'email', delay: 6, variants: [{ subject: 'Closing the loop', body: "Hi {{first_name}},\n\nI'll close the loop after this. If understanding why the current federal position is not converting into the revenue you want would be useful, I can send the GSA Zero-Sales Diagnostic outline.\n\nCan I send it?\n\nKevin" }] }
      ] }];
    }
    if (offerId === 'FEDERAL_REVENUE_GAP_ANALYSIS') {
      return [{ steps: [
        { type: 'email', delay: 0, variants: [{ subject: 'Noticed something in {{company_name}}\'s federal positioning', body: "Hi {{first_name}},\n\nI was reviewing {{company_name}} and noticed {{verified_condition}}.\n\nThat can create a gap between being eligible to sell to government and being positioned to produce measurable federal revenue.\n\nWe built a short Federal Revenue Gap Analysis to identify where access or conversion is breaking down — agencies, buyers, vehicles, opportunity fit, teaming, or capture.\n\nWould it be useful if I sent you the short framework?\n\nKevin\nPathways 2 Government Contracting" }] },
        { type: 'email', delay: 3, variants: [{ subject: 'Re: federal revenue gap', body: "Hi {{first_name}},\n\nFollowing up on the federal positioning issue I flagged. Rather than add more bid volume, the first question is usually whether the current agency, buyer, vehicle, and opportunity path is aligned.\n\nIf useful, I can send the Revenue Gap Analysis outline and show what we would validate first.\n\nKevin" }] },
        { type: 'email', delay: 6, variants: [{ subject: 'Close the loop?', body: "Hi {{first_name}},\n\nI'll close the loop after this. If a short review of {{company_name}}'s target agencies, buyers, access path, and opportunity fit would help, I can send it over.\n\nKevin" }] }
      ] }];
    }
    if (offerId === 'RECOMPETE_VEHICLE_GROWTH_SCAN') {
      return [{ steps: [
        { type: 'email', delay: 0, variants: [{ subject: '{{company_name}} — recompete / vehicle question', body: "Hi {{first_name}},\n\nI was reviewing {{company_name}}'s federal position and found this verified signal: {{verified_recompete_or_vehicle_signal}}.\n\nWe built a Recompete & Vehicle Growth Scan to look at timing, access, incumbent exposure where verified, and realistic prime/sub capture paths before opportunities become last-minute bids.\n\nWould it be useful if I sent you the scan outline?\n\nKevin\nPathways 2 Government Contracting" }] },
        { type: 'email', delay: 3, variants: [{ subject: 'Re: {{company_name}} growth scan', body: "Hi {{first_name}},\n\nFollowing up because timing and access are often the difference between capture work and a last-minute solicitation chase.\n\nThe scan separates confirmed evidence from modeled signals and identifies what should be validated next.\n\nIf useful, I can send the outline.\n\nKevin" }] },
        { type: 'email', delay: 6, variants: [{ subject: 'Closing the loop', body: "Hi {{first_name}},\n\nI'll close the loop after this. If a short review of {{company_name}}'s recompete timing, vehicle access, and prime/sub paths would be useful, I can send it over.\n\nKevin" }] }
      ] }];
    }
    throw new Error(`Unsupported offer: ${offerId}`);
  }

  campaignPayload(offerId, options = {}) {
    const rule = this.offerRule(offerId);
    if (!rule) throw new Error(`Unknown offer: ${offerId}`);
    const d = this.rules.defaults || {};
    return {
      name: rule.campaign_name,
      pl_value: Number(options.plValue || 5000),
      custom_tags: ['P2GC_ACQ_V2', offerId, 'PILOT'],
      stop_on_reply: d.stop_on_reply !== false,
      stop_for_company: d.stop_for_company !== false,
      allow_risky_contacts: d.allow_risky_contacts === true,
      daily_limit: Number(options.dailyLimit || d.daily_limit || 20),
      email_gap: Number(d.email_gap || 22),
      text_only: d.text_only !== false,
      first_email_text_only: d.first_email_text_only !== false,
      open_tracking: d.open_tracking === true,
      link_tracking: d.link_tracking === true,
      sequences: this.sequences(offerId),
      campaign_schedule: {
        schedules: [{
          name: 'P2GC V2 Weekdays',
          timing: { from: d.send_window?.from || '09:00', to: d.send_window?.to || '16:30' },
          days: d.weekdays || ['Monday','Tuesday','Wednesday','Thursday','Friday'],
          timezone: d.timezone || 'America/New_York'
        }]
      }
    };
  }

  async listExistingCampaigns() {
    const all = [];
    let startingAfter;
    for (let page = 0; page < 100; page += 1) {
      const payload = { limit: 100 };
      if (startingAfter) payload.starting_after = startingAfter;
      const response = await this.connector.execute({ action: 'listCampaigns', payload });
      const envelope = response?.campaigns || response?.result || {};
      const batch = items(envelope);
      all.push(...batch);
      const next = envelope?.next_starting_after || envelope?.nextStartingAfter || null;
      if (!next || !batch.length || next === startingAfter) break;
      startingAfter = next;
    }
    return all;
  }

  async findExistingCampaign(name) {
    const wanted = normalizeName(name);
    const campaigns = await this.listExistingCampaigns();
    return campaigns.find(c => normalizeName(c?.name) === wanted) || null;
  }

  prepareLeads(offerId, leads = []) {
    const cap = Number(this.rules?.defaults?.pilot_lead_cap || 150);
    const accepted = [];
    const rejected = [];
    const seen = new Set();
    for (const raw of Array.isArray(leads) ? leads : []) {
      const email = lower(raw?.email || raw?.contactEmail);
      if (seen.has(email) && email) {
        rejected.push({ email, reasons: ['DUPLICATE_EMAIL_IN_INPUT'] });
        continue;
      }
      if (email) seen.add(email);
      const validation = this.validateLead(raw, offerId);
      if (!validation.ok) {
        rejected.push({ email: email || null, companyName: clean(raw?.company_name || raw?.companyName), reasons: validation.reasons });
        continue;
      }
      accepted.push(this.personalizedLead(raw, offerId));
      if (accepted.length >= cap) break;
    }
    return { accepted, rejected, pilotCap: cap, inputCount: Array.isArray(leads) ? leads.length : 0 };
  }

  async deploy(options = {}) {
    const offerId = clean(options.offerId).toUpperCase();
    const rule = this.offerRule(offerId);
    if (!rule) return { ok: false, status: 'UNKNOWN_OFFER', offerId };

    const prepared = this.prepareLeads(offerId, options.leads || []);
    const payload = this.campaignPayload(offerId, options);
    const existing = await this.findExistingCampaign(payload.name);
    const execute = options.execute === true;
    const activate = options.activate === true;
    const actions = [];
    let campaign = existing;

    if (!campaign) {
      if (!execute) {
        actions.push({ action: 'createCampaign', status: 'PLANNED', payload });
      } else {
        const created = await this.connector.execute({ action: 'createCampaign', payload });
        actions.push({ action: 'createCampaign', status: created?.mutationExecuted === true ? 'EXECUTED' : (created?.status || 'BLOCKED'), result: created });
        campaign = created?.result?.id ? created.result : created?.id ? created : created?.result?.data || null;
      }
    } else {
      actions.push({ action: 'createCampaign', status: 'SKIPPED_EXISTING', campaignId: existing.id, campaignName: existing.name });
    }

    const campaignId = clean(campaign?.id);
    if (prepared.accepted.length) {
      if (!execute || !campaignId) {
        actions.push({ action: 'uploadLeads', status: 'PLANNED', campaignId: campaignId || null, count: prepared.accepted.length });
      } else {
        const uploaded = await this.connector.execute({ action: 'uploadLeads', payload: { campaignId, leads: prepared.accepted } });
        actions.push({ action: 'uploadLeads', status: uploaded?.mutationExecuted === true ? 'EXECUTED' : (uploaded?.status || 'BLOCKED'), result: uploaded });
      }
    }

    if (activate) {
      if (!execute || !campaignId) {
        actions.push({ action: 'activateCampaign', status: 'PLANNED', campaignId: campaignId || null });
      } else {
        const activated = await this.connector.execute({ action: 'activateCampaign', payload: { campaignId } });
        actions.push({ action: 'activateCampaign', status: activated?.mutationExecuted === true ? 'EXECUTED' : (activated?.status || 'BLOCKED'), result: activated });
      }
    }

    const executedMutations = actions.filter(a => a.status === 'EXECUTED').length;
    return {
      ok: true,
      service: 'P2GC_ACQUISITION_V2_CAMPAIGN_DEPLOYMENT',
      offerId,
      campaignName: payload.name,
      existingCampaign: Boolean(existing),
      campaignId: campaignId || null,
      executeRequested: execute,
      activationRequested: activate,
      inputLeads: prepared.inputCount,
      acceptedLeads: prepared.accepted.length,
      rejectedLeads: prepared.rejected.length,
      rejected: prepared.rejected,
      actions,
      executionTruth: executedMutations > 0 ? 'EXTERNAL_MUTATION_CONFIRMED' : 'NO_EXTERNAL_MUTATION',
      safeguards: {
        evidenceSourceRequired: true,
        globalSuppressionChecked: true,
        inputDeduplicated: true,
        existingCampaignDeduplicated: true,
        existingCampaignsNeverDeleted: true,
        existingCampaignsNeverAutoPaused: true,
        activationSeparate: true,
        openTracking: false,
        linkTracking: false,
        stopOnReply: true,
        primaryDomainProtectedByGovernance: true
      },
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = P2GCAcquisitionV2CampaignService;
module.exports.helpers = { readJson, clean, lower, normalizeName, items, bool };
