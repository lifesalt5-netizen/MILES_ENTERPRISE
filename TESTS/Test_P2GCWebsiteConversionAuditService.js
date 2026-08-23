'use strict';

const assert = require('assert');
const P2GCWebsiteConversionAuditService = require('../SERVICES/revenue/P2GCWebsiteConversionAuditService');

function response(status, url, html) {
  return { ok: status >= 200 && status < 300, status, url, async text() { return html; } };
}

(async () => {
  const manifest = {
    public_validation: { home_url: 'https://example.test/' },
    operations: [
      { id: 'HOME', target: '/', required_markers: ['Hero Marker', 'CTA Marker'] },
      { id: 'PAGE_A', target: '/page-a', required_markers: ['Page A Marker'] },
      { id: 'LEGACY_POSITIONING_CLEANUP', target: '/business-plans', required_markers: [] }
    ]
  };

  const fakeFetch = async url => {
    if (url.endsWith('/business-plans')) return response(200, url, '<html><head><meta name="robots" content="noindex,nofollow"></head><body>legacy</body></html>');
    if (url.endsWith('/page-a')) return response(200, url, '<html><body>Page A Marker</body></html>');
    return response(200, url, '<html><body><h1>Hero Marker</h1><a href="/page-a">CTA Marker</a></body></html>');
  };

  const service = new P2GCWebsiteConversionAuditService({
    rootDir: process.cwd(),
    manifest,
    baseUrl: 'https://example.test',
    fetch: fakeFetch,
    outputDir: require('os').tmpdir()
  });
  const result = await service.run();
  assert.equal(result.ok, true);
  assert.equal(result.requiredPagesPassing, 2);
  assert.equal(result.requiredPagesTotal, 2);
  assert.equal(result.legacyCleanupPassing, true);

  const failing = new P2GCWebsiteConversionAuditService({
    rootDir: process.cwd(),
    manifest,
    baseUrl: 'https://example.test',
    fetch: async url => response(200, url, '<html><body>missing</body></html>'),
    outputDir: require('os').tmpdir()
  });
  const failed = await failing.run();
  assert.equal(failed.ok, false);

  console.log('P2GCWebsiteConversionAuditService tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
