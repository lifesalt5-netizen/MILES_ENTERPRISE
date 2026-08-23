'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P2GCLinkedInPublishingService = require('../SERVICES/revenue/P2GCLinkedInPublishingService');

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p2gc-li-'));
  const authorityPath = path.join(root, 'authority.json');
  const buyerPath = path.join(root, 'buyer.json');
  const outputDir = path.join(root, 'out');

  write(authorityPath, { items: [{ id: 'AUTH1', date: '2026-08-23', publication_status: 'READY_FOR_CHANNEL_EXECUTION', channels: ['LINKEDIN'], drafts: { linkedin: 'Authority post' }, cta: 'Score' }] });
  write(buyerPath, { snapshotDate: '2026-08-23', items: [{ id: 'BUY1', source_date: '2026-08-23', content_status: 'READY_FOR_CHANNEL_EXECUTION', drafts: { linkedin: 'Buyer lens post' }, cta: 'Gap', source_url: 'https://example.gov' }] });

  const calls = [];
  const publisher = {
    async publishText(payload) {
      calls.push(payload);
      return { ok: true, status: payload.publish ? 'POST_PUBLISHED' : 'CONTROLLED_DRY_RUN', mutationExecuted: payload.publish === true, targetUrl: 'https://www.linkedin.com/feed/', outputFile: path.join(outputDir, 'latest.json') };
    }
  };

  const service = new P2GCLinkedInPublishingService({ rootDir: root, authorityPath, buyerLensPath: buyerPath, outputDir, publisher, now: () => new Date('2026-08-23T16:00:00Z') });
  const dry = await service.run({ publish: false });
  assert.equal(dry.selected.contentId, 'BUY1');
  assert.equal(dry.mutationExecuted, false);
  const live = await service.run({ publish: true });
  assert.equal(live.ok, true);
  assert.equal(live.mutationExecuted, true);
  const ledger = JSON.parse(fs.readFileSync(path.join(outputDir, 'ledger.json'), 'utf8'));
  assert.equal(ledger.published.length, 1);
  assert.equal(ledger.published[0].contentId, 'BUY1');
  const next = service.select();
  assert.equal(next.contentId, 'AUTH1');
  assert.equal(calls.length, 2);
  console.log('P2GCLinkedInPublishingService tests passed');
})().catch(error => { console.error(error); process.exit(1); });
