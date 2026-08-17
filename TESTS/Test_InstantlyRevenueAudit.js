'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const InstantlyRevenueAuditService = require('../SERVICES/digital_coo/InstantlyRevenueAuditService');

class FakeRuntime {
  loadAllConnectors() {
    return { ok: true, loadedConnectors: ['INSTANTLY'] };
  }

  async execute(request) {
    const action = request.connectorAction;
    const payload = request.payload || {};

    if (action === 'getCampaignAnalytics') {
      return {
        ok: true,
        result: {
          ok: true,
          analytics: [
            {
              campaign_id: 'high-bounce',
              campaign_name: 'High Bounce',
              campaign_status: 1,
              leads_count: 1200,
              contacted_count: 1000,
              emails_sent_count: 1500,
              reply_count_unique: 20,
              reply_count_automatic_unique: 2,
              bounced_count: 50
            },
            {
              campaign_id: 'low-reply',
              campaign_name: 'Low Reply',
              campaign_status: 1,
              leads_count: 1200,
              contacted_count: 1000,
              emails_sent_count: 1400,
              reply_count_unique: 6,
              reply_count_automatic_unique: 2,
              bounced_count: 2
            },
            {
              campaign_id: 'reply-leak',
              campaign_name: 'Reply Leak',
              campaign_status: 1,
              leads_count: 1000,
              contacted_count: 800,
              emails_sent_count: 1300,
              reply_count_unique: 32,
              reply_count_automatic_unique: 2,
              bounced_count: 3
            }
          ]
        }
      };
    }

    if (action === 'getCampaignAnalyticsOverview') {
      if (!payload.id) {
        return {
          ok: true,
          result: {
            ok: true,
            analytics: {
              contacted_count: 2800,
              emails_sent_count: 4200,
              reply_count_unique: 58,
              reply_count_automatic_unique: 6,
              bounced_count: 55,
              total_interested: 0,
              total_meeting_booked: 0,
              total_meeting_completed: 0,
              total_closed: 0
            }
          }
        };
      }

      const byId = {
        'high-bounce': {
          contacted_count: 1000,
          emails_sent_count: 1500,
          reply_count_unique: 20,
          reply_count_automatic_unique: 2,
          bounced_count: 50,
          total_interested: 2,
          total_meeting_booked: 0,
          total_meeting_completed: 0,
          total_closed: 0,
          total_opportunities: 2
        },
        'low-reply': {
          contacted_count: 1000,
          emails_sent_count: 1400,
          reply_count_unique: 6,
          reply_count_automatic_unique: 2,
          bounced_count: 2,
          total_interested: 0,
          total_meeting_booked: 0,
          total_meeting_completed: 0,
          total_closed: 0,
          total_opportunities: 0
        },
        'reply-leak': {
          contacted_count: 800,
          emails_sent_count: 1300,
          reply_count_unique: 32,
          reply_count_automatic_unique: 2,
          bounced_count: 3,
          total_interested: 0,
          total_meeting_booked: 0,
          total_meeting_completed: 0,
          total_closed: 0,
          total_opportunities: 0
        }
      };

      return {
        ok: true,
        result: { ok: true, analytics: byId[payload.id] }
      };
    }

    if (action === 'getCampaignStepsAnalytics') {
      const steps = payload.campaign_id === 'reply-leak'
        ? [
            { step: '1', variant: '0', sent: 800, unique_replies: 17, unique_replies_automatic: 2 },
            { step: '2', variant: '0', sent: 500, unique_replies: 15, unique_replies_automatic: 0 }
          ]
        : [
            { step: '1', variant: '0', sent: 1000, unique_replies: 5, unique_replies_automatic: 0 }
          ];

      return {
        ok: true,
        result: { ok: true, analytics: steps }
      };
    }

    return { ok: false, error: `Unexpected action: ${action}` };
  }
}

async function run() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-instantly-audit-'));

  try {
    const service = new InstantlyRevenueAuditService({
      rootDir: temporaryRoot,
      runtime: new FakeRuntime()
    });

    const health = await service.healthCheck();
    assert.strictEqual(health.ok, true);
    assert.strictEqual(health.readOnly, true);

    const audit = await service.generateAudit();
    assert.strictEqual(audit.ok, true);
    assert.strictEqual(audit.readOnly, true);
    assert.strictEqual(audit.summary.campaignsAudited, 3);

    const byId = Object.fromEntries(audit.campaigns.map(item => [item.campaignId, item]));
    assert.strictEqual(byId['high-bounce'].diagnosis, 'DELIVERABILITY/LIST');
    assert.strictEqual(byId['low-reply'].diagnosis, 'DELIVERABILITY/TARGETING/MESSAGE');
    assert.strictEqual(byId['reply-leak'].diagnosis, 'REPLY_HANDLING/CRM_CLASSIFICATION');
    assert.strictEqual(byId['reply-leak'].sequence.firstStepReplies, 15);
    assert.strictEqual(byId['reply-leak'].sequence.followupReplies, 15);
    assert.strictEqual(byId['reply-leak'].sequence.followupReplyShare, 0.5);

    assert.strictEqual(audit.campaigns[0].campaignId, 'high-bounce');
    assert.ok(fs.existsSync(service.latestJsonPath));
    assert.ok(fs.existsSync(service.latestMarkdownPath));

    const healthy = service.diagnoseCampaign(
      {
        campaign_id: 'healthy',
        campaign_name: 'Healthy',
        contacted_count: 1000,
        emails_sent_count: 1500,
        reply_count_unique: 45,
        reply_count_automatic_unique: 5,
        bounced_count: 5
      },
      {
        contacted_count: 1000,
        emails_sent_count: 1500,
        reply_count_unique: 45,
        reply_count_automatic_unique: 5,
        bounced_count: 5,
        total_interested: 15,
        total_meeting_booked: 8,
        total_meeting_completed: 6,
        total_closed: 2,
        total_opportunities: 15
      },
      service.analyzeSteps([
        { step: '1', unique_replies: 25, unique_replies_automatic: 3 },
        { step: '2', unique_replies: 20, unique_replies_automatic: 2 }
      ])
    );
    assert.strictEqual(healthy.diagnosis, 'HEALTHY/SCALE');

    console.log('PASS Test_InstantlyRevenueAudit');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
