'use strict';

const fs = require('fs');
const path = require('path');

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

class P2GCWebsiteConversionAuditService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.manifestPath = options.manifestPath || path.join(this.rootDir, 'CONFIG', 'p2gc_b12_conversion_publish_v2.json');
    this.manifest = options.manifest || JSON.parse(fs.readFileSync(this.manifestPath, 'utf8').replace(/^\uFEFF/, ''));
    this.baseUrl = String(options.baseUrl || this.manifest?.public_validation?.home_url || 'https://www.pathways2gc.com/').replace(/\/$/, '');
    this.fetch = options.fetch || global.fetch;
    this.outputDir = options.outputDir || path.join(this.rootDir, 'DATA', 'website_ops', 'p2gc_conversion_audit');
  }

  async fetchPage(targetPath) {
    const url = targetPath.startsWith('http') ? targetPath : `${this.baseUrl}${targetPath === '/' ? '/' : targetPath}`;
    try {
      const response = await this.fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'MILES-P2GC-Website-Audit/1.0' }
      });
      const html = await response.text();
      return { ok: response.ok, status: response.status, url: response.url || url, html, text: stripHtml(html) };
    } catch (error) {
      return { ok: false, status: null, url, html: '', text: '', error: error.message };
    }
  }

  async run() {
    const checks = [];
    for (const op of this.manifest.operations || []) {
      if (op.id === 'LEGACY_POSITIONING_CLEANUP') continue;
      const page = await this.fetchPage(op.target || '/');
      const markers = (op.required_markers || []).map(marker => ({ marker, present: page.text.includes(marker) }));
      checks.push({
        id: op.id,
        target: op.target,
        status: page.status,
        resolvedUrl: page.url,
        markers,
        ok: page.ok && markers.every(x => x.present),
        error: page.error || null
      });
    }

    const home = await this.fetchPage('/');
    const legacy = await this.fetchPage('/business-plans');
    const legacyNavAbsent = !/href=["'][^"']*\/business-plans(?:["'/?#])/i.test(home.html);
    const noindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(legacy.html) ||
      /<meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]+name=["']robots/i.test(legacy.html);
    const legacyOk = legacyNavAbsent && ([404, 410].includes(Number(legacy.status)) || noindex);
    checks.push({
      id: 'LEGACY_POSITIONING_CLEANUP',
      target: '/business-plans',
      homeStatus: home.status,
      legacyStatus: legacy.status,
      legacyResolvedUrl: legacy.url,
      legacyNavAbsent,
      noindex,
      ok: legacyOk
    });

    const report = {
      ok: checks.every(x => x.ok),
      gate: 'P2GC_WEBSITE_CONVERSION_PUBLIC_AUDIT',
      generatedAt: new Date().toISOString(),
      baseUrl: this.baseUrl,
      checks,
      requiredPagesPassing: checks.filter(x => x.id !== 'LEGACY_POSITIONING_CLEANUP' && x.ok).length,
      requiredPagesTotal: checks.filter(x => x.id !== 'LEGACY_POSITIONING_CLEANUP').length,
      legacyCleanupPassing: legacyOk
    };

    fs.mkdirSync(this.outputDir, { recursive: true });
    report.outputFile = path.join(this.outputDir, 'latest.json');
    fs.writeFileSync(report.outputFile, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

async function main() {
  const service = new P2GCWebsiteConversionAuditService();
  const result = await service.run();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1); });
}

module.exports = P2GCWebsiteConversionAuditService;
module.exports.stripHtml = stripHtml;
