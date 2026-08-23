'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}
function clean(v) { return String(v || '').trim(); }
function list(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
function bullets(rows) { return list(rows).map(x => `• ${x}`).join('\n'); }

class P2GCBuyerLensContentService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.rulesPath = options.rulesPath || path.join(this.rootDir, 'CONFIG', 'p2gc_buyer_lens_content_rules.json');
    this.rules = options.rules || readJson(this.rulesPath, {});
    this.inputDir = options.inputDir || path.join(this.rootDir, 'DATA', 'marketing_coo', 'buyer_lens_news');
    this.outputDir = options.outputDir || path.join(this.rootDir, 'DATA', 'marketing_coo', 'buyer_lens_content');
  }

  latestSnapshotPath() {
    if (!fs.existsSync(this.inputDir)) return null;
    const files = fs.readdirSync(this.inputDir).filter(x => /^\d{4}-\d{2}-\d{2}\.json$/i.test(x)).sort();
    return files.length ? path.join(this.inputDir, files[files.length - 1]) : null;
  }

  validate(item = {}) {
    const reasons = [];
    const required = ['id','headline','official_status','source_name','source_url','source_date','official_fact','buyer_lens','common_mistake','action_now','p2gc_take','cta'];
    for (const field of required) if (!clean(item[field])) reasons.push(`MISSING_${field.toUpperCase()}`);
    if (!/^https?:\/\//i.test(clean(item.source_url))) reasons.push('INVALID_SOURCE_URL');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(item.source_date))) reasons.push('INVALID_SOURCE_DATE');
    if (!list(item.scrutiny).length) reasons.push('MISSING_SCRUTINY_POINTS');
    if (!list(item.affected_segments).length) reasons.push('MISSING_AFFECTED_SEGMENTS');
    return { ok: reasons.length === 0, reasons };
  }

  renderLinkedIn(item) {
    return `${item.headline}\n\nWHAT CHANGED\n${item.official_fact}\n\nBUYER LENS\n${item.buyer_lens}\n\nWHAT BUYERS MAY SCRUTINIZE MORE CLOSELY\n${bullets(item.scrutiny)}\n\nWHO BENEFITS / WHO FACES MORE PRESSURE\n${item.benefit_or_risk}\n\nCOMMON CONTRACTOR MISTAKE\n${item.common_mistake}\n\nACTION TO TAKE NOW\n${item.action_now}\n\nP2GC TAKE\n${item.p2gc_take}\n\n${item.cta}.`;
  }

  renderShortVideo(item) {
    const scrutiny = list(item.scrutiny).slice(0, 2).join(' and ');
    return `Here is the contractor impact behind this update: ${item.official_fact} From the buyer side, ${item.buyer_lens} That means I would expect more attention on ${scrutiny || 'the evidence supporting your position'}. The mistake to avoid is ${item.common_mistake} What should you do now? ${item.action_now} P2GC take: ${item.p2gc_take} CTA: ${item.cta}.`;
  }

  renderEmail(item) {
    return `Subject: P2GC Buyer Lens — ${item.headline}\n\nOfficial update\n${item.official_fact}\n\nWhat it may mean from the buyer side\n${item.buyer_lens}\n\nWhat contractors should check now\n${bullets(item.scrutiny)}\n\nMistake to avoid\n${item.common_mistake}\n\nAction\n${item.action_now}\n\nP2GC take\n${item.p2gc_take}\n\nCTA: ${item.cta}.\n\nSource: ${item.source_name} — ${item.source_url}`;
  }

  run(options = {}) {
    const snapshotPath = options.snapshotPath || this.latestSnapshotPath();
    const snapshot = options.snapshot || (snapshotPath ? readJson(snapshotPath, {}) : {});
    const raw = Array.isArray(snapshot.items) ? snapshot.items : [];
    const items = [];
    const rejected = [];

    raw.forEach(item => {
      const validation = this.validate(item);
      if (!validation.ok) {
        rejected.push({ id: item?.id || null, reasons: validation.reasons });
        return;
      }
      items.push({
        ...item,
        content_status: 'READY_FOR_CHANNEL_EXECUTION',
        drafts: {
          linkedin: this.renderLinkedIn(item),
          short_video: this.renderShortVideo(item),
          intelligence_email: this.renderEmail(item)
        },
        attribution: {
          publication_date: null,
          content_id: item.id,
          source_url: item.source_url,
          news_topic: item.headline,
          affected_segment: list(item.affected_segments).join('|'),
          cta: item.cta,
          impressions_or_views: 0,
          site_visits: 0,
          diagnostic_starts: 0,
          booked_meetings: 0,
          proposals: 0,
          closes: 0,
          attributed_revenue: 0
        }
      });
    });

    const report = {
      ok: Boolean(snapshot.snapshot_date) && rejected.length === 0,
      service: 'P2GC_BUYER_LENS_CONTENT',
      generatedAt: new Date().toISOString(),
      snapshotDate: snapshot.snapshot_date || null,
      snapshotPath: snapshotPath || null,
      totals: { observed: raw.length, ready: items.length, rejected: rejected.length },
      items,
      rejected,
      governance: {
        authoritativeSourceRequired: true,
        officialFactSeparatedFromP2gcAnalysis: true,
        proposedVsFinalStatusRetained: true,
        buyerIntentNotStatedAsFactWithoutEvidence: true,
        competitorCopyingProhibited: true,
        practicalActionRequired: true,
        revenueAttributionRequired: true
      },
      channelExecution: {
        autoPublishPerformed: false,
        note: 'Drafts are channel-ready; external publication requires the governed channel publisher or approved manual publication path.'
      }
    };

    fs.mkdirSync(this.outputDir, { recursive: true });
    report.outputFile = path.join(this.outputDir, 'buyer_lens_queue_latest.json');
    fs.writeFileSync(report.outputFile, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

module.exports = P2GCBuyerLensContentService;
module.exports.helpers = { readJson, clean, list, bullets };
