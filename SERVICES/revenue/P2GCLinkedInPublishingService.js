'use strict';

const fs = require('fs');
const path = require('path');
const LinkedInControlledPublisher = require('../../CONNECTORS/LINKEDIN/LinkedInControlledPublisher');

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}
function clean(v) { return String(v || '').trim(); }
function dateOnly(v) {
  const d = v instanceof Date ? v : new Date(v || Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0,10) : d.toISOString().slice(0,10);
}

class P2GCLinkedInPublishingService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.authorityPath = options.authorityPath || path.join(this.rootDir, 'DATA', 'marketing_coo', 'authority_content', 'production_queue_latest.json');
    this.buyerLensPath = options.buyerLensPath || path.join(this.rootDir, 'DATA', 'marketing_coo', 'buyer_lens_content', 'buyer_lens_queue_latest.json');
    this.outputDir = options.outputDir || path.join(this.rootDir, 'DATA', 'marketing_coo', 'linkedin_publish');
    this.ledgerPath = path.join(this.outputDir, 'ledger.json');
    this.publisher = options.publisher || new LinkedInControlledPublisher({ rootDir: this.rootDir, outputDir: this.outputDir });
    this.now = options.now || (() => new Date());
  }

  ledger() {
    const value = readJson(this.ledgerPath, { version: 1, published: [] });
    value.published = Array.isArray(value.published) ? value.published : [];
    return value;
  }

  candidates() {
    const today = dateOnly(this.now());
    const ledger = this.ledger();
    const publishedIds = new Set(ledger.published.map(x => clean(x.contentId)));
    const rows = [];

    const authority = readJson(this.authorityPath, { items: [] });
    for (const item of authority.items || []) {
      if (publishedIds.has(clean(item.id))) continue;
      if (item.publication_status !== 'READY_FOR_CHANNEL_EXECUTION') continue;
      if (!Array.isArray(item.channels) || !item.channels.includes('LINKEDIN')) continue;
      const text = clean(item?.drafts?.linkedin);
      if (!text) continue;
      const due = clean(item.date) || today;
      if (due > today) continue;
      rows.push({
        contentId: item.id,
        sourceType: 'AUTHORITY',
        dueDate: due,
        sourceDate: due,
        priority: 2,
        text,
        cta: item.cta || '',
        sourceUrl: null
      });
    }

    const buyer = readJson(this.buyerLensPath, { items: [] });
    for (const item of buyer.items || []) {
      if (publishedIds.has(clean(item.id))) continue;
      if (item.content_status !== 'READY_FOR_CHANNEL_EXECUTION') continue;
      const text = clean(item?.drafts?.linkedin);
      if (!text) continue;
      const sourceDate = clean(item.source_date) || clean(buyer.snapshotDate) || today;
      if (sourceDate > today) continue;
      rows.push({
        contentId: item.id,
        sourceType: 'BUYER_LENS',
        dueDate: today,
        sourceDate,
        priority: 1,
        text,
        cta: item.cta || '',
        sourceUrl: item.source_url || null
      });
    }

    rows.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const sourceDiff = clean(b.sourceDate).localeCompare(clean(a.sourceDate));
      if (sourceDiff) return sourceDiff;
      return clean(a.contentId).localeCompare(clean(b.contentId));
    });
    return rows;
  }

  select(options = {}) {
    const requestedId = clean(options.contentId || process.env.P2GC_LINKEDIN_CONTENT_ID);
    const rows = this.candidates();
    if (requestedId) return rows.find(x => x.contentId === requestedId) || null;
    return rows[0] || null;
  }

  async run(options = {}) {
    const publish = options.publish === true;
    const selected = this.select(options);
    if (!selected) {
      const result = {
        ok: true,
        service: 'P2GC_LINKEDIN_PUBLISHING',
        generatedAt: new Date(this.now().getTime()).toISOString(),
        status: 'NO_DUE_READY_POST',
        mutationExecuted: false,
        candidates: 0
      };
      writeJson(path.join(this.outputDir, 'latest.json'), result);
      return result;
    }

    const result = await this.publisher.publishText({
      contentId: selected.contentId,
      text: selected.text,
      publish
    });

    const combined = {
      ...result,
      service: 'P2GC_LINKEDIN_PUBLISHING',
      selected,
      candidates: this.candidates().length,
      publishRequested: publish
    };

    if (combined.ok === true && combined.mutationExecuted === true) {
      const ledger = this.ledger();
      if (!ledger.published.some(x => x.contentId === selected.contentId)) {
        ledger.published.push({
          contentId: selected.contentId,
          sourceType: selected.sourceType,
          sourceUrl: selected.sourceUrl,
          publishedAt: new Date(this.now().getTime()).toISOString(),
          targetUrl: combined.targetUrl || null,
          evidenceFile: combined.outputFile || null
        });
        writeJson(this.ledgerPath, ledger);
      }
    }

    writeJson(path.join(this.outputDir, 'latest.json'), combined);
    return combined;
  }
}

module.exports = P2GCLinkedInPublishingService;
module.exports.helpers = { readJson, writeJson, clean, dateOnly };
