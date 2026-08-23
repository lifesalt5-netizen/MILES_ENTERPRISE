'use strict';

const assert = require('assert');
const P2GCAcquisitionV2CampaignService = require('../SERVICES/revenue/P2GCAcquisitionV2CampaignService');

(async () => {
  const rules = {
    defaults: {
      daily_limit: 20,
      email_gap: 22,
      timezone: 'America/New_York',
      send_window: { from: '09:00', to: '16:30' },
      weekdays: ['Monday','Tuesday','Wednesday','Thursday','Friday'],
      stop_on_reply: true,
      stop_for_company: true,
      allow_risky_contacts: false,
      open_tracking: false,
      link_tracking: false,
      text_only: true,
      first_email_text_only: true,
      pilot_lead_cap: 150
    },
    offers: {
      GSA_ZERO_SALES_DIAGNOSTIC: {
        campaign_name: 'P2GC V2 - GSA Zero Sales Diagnostic - Pilot',
        required_fact_fields: ['verified_condition'],
        required_source_fields: ['verified_condition_source']
      },
      FEDERAL_REVENUE_GAP_ANALYSIS: {
        campaign_name: 'P2GC V2 - Federal Revenue Gap Analysis - Pilot',
        required_fact_fields: ['verified_condition'],
        required_source_fields: ['verified_condition_source']
      },
      RECOMPETE_VEHICLE_GROWTH_SCAN: {
        campaign_name: 'P2GC V2 - Recompete Vehicle Growth Scan - Pilot',
        required_fact_fields: ['verified_recompete_or_vehicle_signal'],
        required_source_fields: ['verified_recompete_or_vehicle_signal_source']
      }
    }
  };

  const calls = [];
  const connector = {
    async execute(task) {
      calls.push(task);
      if (task.action === 'listCampaigns') return { campaigns: { items: [] } };
      if (task.action === 'createCampaign') return { ok: true, mutationExecuted: true, result: { id: 'CAMP-NEW', name: task.payload.name } };
      if (task.action === 'uploadLeads') return { ok: true, mutationExecuted: true, status: 'LEADS_UPLOADED' };
      if (task.action === 'activateCampaign') return { ok: true, mutationExecuted: true, status: 'CAMPAIGN_ACTIVATED' };
      throw new Error(`Unexpected action ${task.action}`);
    }
  };
  const suppression = { isSuppressed(email) { return email === 'suppressed@example.com'; } };
  const service = new P2GCAcquisitionV2CampaignService({ rules, connector, suppression });

  const leads = [
    {
      email: 'good@example.com',
      first_name: 'Pat',
      company_name: 'Good Co',
      segment: 'GSA_NO_SALES',
      verified_condition: 'the Schedule shows no verified federal sales in the reviewed period',
      verified_condition_source: 'GSA/USAspending review'
    },
    {
      email: 'nosource@example.com',
      company_name: 'No Source Co',
      verified_condition: 'a claimed condition without retained source'
    },
    {
      email: 'suppressed@example.com',
      company_name: 'Suppressed Co',
      verified_condition: 'verified condition',
      verified_condition_source: 'source'
    },
    {
      email: 'good@example.com',
      company_name: 'Duplicate Co',
      verified_condition: 'verified condition',
      verified_condition_source: 'source'
    }
  ];

  const planned = await service.deploy({ offerId: 'GSA_ZERO_SALES_DIAGNOSTIC', leads, execute: false, activate: false });
  assert.equal(planned.ok, true);
  assert.equal(planned.acceptedLeads, 1);
  assert.equal(planned.rejectedLeads, 3);
  assert.equal(planned.executionTruth, 'NO_EXTERNAL_MUTATION');
  assert.equal(planned.safeguards.openTracking, false);
  assert.equal(planned.safeguards.linkTracking, false);
  assert.ok(planned.rejected.some(x => x.reasons.includes('MISSING_VERIFIED_CONDITION_SOURCE')));
  assert.ok(planned.rejected.some(x => x.reasons.includes('GLOBAL_SUPPRESSION')));
  assert.ok(planned.rejected.some(x => x.reasons.includes('DUPLICATE_EMAIL_IN_INPUT')));
  assert.equal(calls.filter(x => x.action === 'createCampaign').length, 0);

  const live = await service.deploy({ offerId: 'GSA_ZERO_SALES_DIAGNOSTIC', leads: [leads[0]], execute: true, activate: true });
  assert.equal(live.campaignId, 'CAMP-NEW');
  assert.equal(live.executionTruth, 'EXTERNAL_MUTATION_CONFIRMED');
  assert.equal(calls.filter(x => x.action === 'createCampaign').length, 1);
  assert.equal(calls.filter(x => x.action === 'uploadLeads').length, 1);
  assert.equal(calls.filter(x => x.action === 'activateCampaign').length, 1);

  const existingConnector = {
    async execute(task) {
      if (task.action === 'listCampaigns') return { campaigns: { items: [{ id: 'CAMP-EXISTING', name: 'P2GC V2 - GSA Zero Sales Diagnostic - Pilot' }] } };
      if (task.action === 'uploadLeads') return { ok: false, status: 'DRY_RUN', mutationExecuted: false };
      throw new Error(`Unexpected mutation ${task.action}`);
    }
  };
  const existingService = new P2GCAcquisitionV2CampaignService({ rules, connector: existingConnector, suppression: { isSuppressed(){ return false; } } });
  const existing = await existingService.deploy({ offerId: 'GSA_ZERO_SALES_DIAGNOSTIC', leads: [leads[0]], execute: false });
  assert.equal(existing.existingCampaign, true);
  assert.equal(existing.campaignId, 'CAMP-EXISTING');
  assert.ok(existing.actions.some(x => x.action === 'createCampaign' && x.status === 'SKIPPED_EXISTING'));

  const recompeteBad = service.validateLead({
    email: 'r@example.com', company_name: 'R Co', verified_recompete_or_vehicle_signal: 'modeled signal'
  }, 'RECOMPETE_VEHICLE_GROWTH_SCAN');
  assert.equal(recompeteBad.ok, false);
  assert.ok(recompeteBad.reasons.includes('MISSING_VERIFIED_RECOMPETE_OR_VEHICLE_SIGNAL_SOURCE'));

  console.log('P2GCAcquisitionV2CampaignService tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
