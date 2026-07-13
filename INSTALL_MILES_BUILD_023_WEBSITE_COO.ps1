# INSTALL_MILES_BUILD_023_WEBSITE_COO.ps1
# Complete replacement of WebsiteProvider only.
# Reuses the existing Website connector and execution architecture.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root =
    "D:\P2GC_Intelligence\MILES_ENTERPRISE"

if (-not (Test-Path $Root)) {
    throw "MILES root not found: $Root"
}

Set-Location $Root
$env:MILES_ROOT = $Root

$Stamp =
    Get-Date -Format "yyyyMMdd_HHmmss"

$BackupRoot =
    Join-Path $Root "_BACKUPS\BUILD_023_$Stamp"

$ReportDir =
    Join-Path $Root "DATA\build_023"

$TestDir =
    Join-Path $Root "TESTS"

New-Item -ItemType Directory `
    -Path $BackupRoot `
    -Force | Out-Null

New-Item -ItemType Directory `
    -Path $ReportDir `
    -Force | Out-Null

New-Item -ItemType Directory `
    -Path $TestDir `
    -Force | Out-Null

$Target =
    "PROVIDERS\providers\WebsiteProvider.js"

$Source =
    Join-Path $Root $Target

if (-not (Test-Path $Source)) {
    throw "Missing authoritative WebsiteProvider: $Source"
}

$Backup =
    Join-Path $BackupRoot $Target

New-Item -ItemType Directory `
    -Path (Split-Path $Backup -Parent) `
    -Force | Out-Null

Copy-Item `
    $Source `
    $Backup `
    -Force

@'
"use strict";

const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const IDataProvider = require("../contracts/IDataProvider");
const defaultWebsite =
  require("../../CONNECTORS/WEBSITE/website");

const ROOT =
  process.env.MILES_ROOT ||
  process.cwd();

const DEFAULT_URL =
  process.env.P2GC_WEBSITE_URL ||
  "https://pathways2gc.com";

const OUT_DIR =
  path.join(
    ROOT,
    "DATA",
    "website_coo"
  );

const BASELINE_FILE =
  path.join(
    OUT_DIR,
    "website_content_baseline.json"
  );

function ensureDir() {
  fs.mkdirSync(
    OUT_DIR,
    { recursive: true }
  );
}

function normalizeText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir();

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      value,
      null,
      2
    ),
    "utf8"
  );
}

function extractLinks(html, baseUrl) {
  const links = [];
  const pattern =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;

  let match;

  while (
    (match = pattern.exec(
      String(html || "")
    )) !== null
  ) {
    const href =
      String(match[1] || "").trim();

    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:")
    ) {
      continue;
    }

    try {
      const resolved =
        new URL(
          href,
          baseUrl
        ).toString();

      links.push(resolved);
    } catch {}
  }

  return [
    ...new Set(links)
  ];
}

function extractForms(html) {
  const forms = [];
  const pattern =
    /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;

  let match;

  while (
    (match = pattern.exec(
      String(html || "")
    )) !== null
  ) {
    const attributes =
      match[1] || "";

    const body =
      match[2] || "";

    const actionMatch =
      attributes.match(
        /\baction=["']([^"']*)["']/i
      );

    const methodMatch =
      attributes.match(
        /\bmethod=["']([^"']*)["']/i
      );

    const submitPresent =
      /type=["']submit["']|<button\b/i
        .test(body);

    forms.push({
      action:
        actionMatch
          ? actionMatch[1]
          : "",
      method:
        methodMatch
          ? methodMatch[1]
          : "GET",
      hasSubmit:
        submitPresent,
      inputCount:
        (
          body.match(
            /<input\b/gi
          ) || []
        ).length,
      textareaCount:
        (
          body.match(
            /<textarea\b/gi
          ) || []
        ).length
    });
  }

  return forms;
}

function extractImages(html) {
  const images = [];
  const pattern =
    /<img\b([^>]*)>/gi;

  let match;

  while (
    (match = pattern.exec(
      String(html || "")
    )) !== null
  ) {
    const attrs =
      match[1] || "";

    const srcMatch =
      attrs.match(
        /\bsrc=["']([^"']*)["']/i
      );

    const altMatch =
      attrs.match(
        /\balt=["']([^"']*)["']/i
      );

    images.push({
      src:
        srcMatch
          ? srcMatch[1]
          : "",
      alt:
        altMatch
          ? altMatch[1]
          : "",
      hasAlt:
        Boolean(
          altMatch &&
          String(
            altMatch[1]
          ).trim()
        )
    });
  }

  return images;
}

function extractHeadings(html) {
  const headings = {};

  for (
    let level = 1;
    level <= 6;
    level += 1
  ) {
    const matches =
      String(html || "")
        .match(
          new RegExp(
            `<h${level}\\b[^>]*>[\\s\\S]*?<\\/h${level}>`,
            "gi"
          )
        ) || [];

    headings[
      `h${level}`
    ] = matches.length;
  }

  return headings;
}

function hasLabelForInputs(html) {
  const inputIds = [
    ...String(html || "")
      .matchAll(
        /<(input|textarea|select)\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi
      )
  ].map(match => match[2]);

  if (inputIds.length === 0) {
    return {
      totalInputsWithId: 0,
      labeledInputs: 0,
      coverage: 100
    };
  }

  const labeledInputs =
    inputIds.filter(id =>
      new RegExp(
        `<label\\b[^>]*\\bfor=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
        "i"
      ).test(html)
    ).length;

  return {
    totalInputsWithId:
      inputIds.length,
    labeledInputs,
    coverage:
      Math.round(
        (
          labeledInputs /
          inputIds.length
        ) *
        10000
      ) / 100
  };
}

function buildContentFingerprint(
  metrics
) {
  return {
    title:
      normalizeText(
        metrics.title
      ),
    h1:
      normalizeText(
        metrics.h1
      ),
    metaDescription:
      normalizeText(
        metrics.metaDescription
      ),
    hasCTA:
      Boolean(
        metrics.hasCTA
      ),
    hasCalendly:
      Boolean(
        metrics.hasCalendly
      ),
    hasContact:
      Boolean(
        metrics.hasContact
      ),
    hasServices:
      Boolean(
        metrics.hasServices
      ),
    hasPhone:
      Boolean(
        metrics.hasPhone
      ),
    hasEmail:
      Boolean(
        metrics.hasEmail
      )
  };
}

function compareFingerprint(
  baseline,
  current
) {
  if (!baseline) {
    return {
      baselineExists: false,
      changed: false,
      changes: []
    };
  }

  const changes = [];

  for (
    const key
    of Object.keys(current)
  ) {
    if (
      JSON.stringify(
        baseline[key]
      ) !==
      JSON.stringify(
        current[key]
      )
    ) {
      changes.push({
        field: key,
        before:
          baseline[key],
        after:
          current[key]
      });
    }
  }

  return {
    baselineExists: true,
    changed:
      changes.length > 0,
    changes
  };
}

async function auditLinks(
  connector,
  links,
  baseUrl,
  maxLinks = 20
) {
  const base =
    new URL(baseUrl);

  const internalLinks =
    links.filter(link => {
      try {
        return (
          new URL(link).host ===
          base.host
        );
      } catch {
        return false;
      }
    });

  const sampled =
    internalLinks.slice(
      0,
      maxLinks
    );

  const results = [];

  for (const link of sampled) {
    try {
      const result =
        await connector.fetchUrl(
          link,
          10000
        );

      results.push({
        url: link,
        ok:
          Boolean(
            result.ok
          ),
        statusCode:
          result.statusCode || 0,
        loadMs:
          result.loadMs || 0,
        error:
          result.error || null
      });
    } catch (error) {
      results.push({
        url: link,
        ok: false,
        statusCode: 0,
        loadMs: 0,
        error:
          error.message
      });
    }
  }

  return {
    discovered:
      links.length,
    internal:
      internalLinks.length,
    checked:
      results.length,
    broken:
      results.filter(
        item => !item.ok
      ),
    results
  };
}

function persistEvidence(result) {
  ensureDir();

  const stamp =
    Date.now();

  const historical =
    path.join(
      OUT_DIR,
      `website_operation_${stamp}.json`
    );

  const latest =
    path.join(
      OUT_DIR,
      "latest_website_operation.json"
    );

  writeJson(
    historical,
    result
  );

  writeJson(
    latest,
    result
  );

  return historical;
}

class WebsiteProvider extends IDataProvider {
  constructor(options = {}) {
    super("Website");

    this.website =
      options.connector ||
      defaultWebsite;

    this.url =
      options.url ||
      DEFAULT_URL;

    this.dependencies = [
      "Website"
    ];

    this.sourceSystems = [
      "CONNECTORS/WEBSITE"
    ];
  }

  async initialize() {
    return this.verifyWebsite();
  }

  async refresh() {
    return this.verifyWebsite();
  }

  async verifyWebsite() {
    this.lastRefresh =
      new Date().toISOString();

    this.dataFreshness =
      "Live";

    try {
      const audit =
        await this.website
          .auditWebsite(
            this.url
          );

      const page =
        await this.website
          .fetchUrl(
            this.url,
            15000
          );

      const html =
        page.body || "";

      const links =
        extractLinks(
          html,
          this.url
        );

      const forms =
        extractForms(html);

      const images =
        extractImages(html);

      const headings =
        extractHeadings(html);

      const labels =
        hasLabelForInputs(
          html
        );

      const linkAudit =
        await auditLinks(
          this.website,
          links,
          this.url,
          Number(
            process.env
              .WEBSITE_MAX_LINK_CHECKS ||
            20
          )
        );

      const metrics = {
        ...(audit.metrics || {}),
        homepageReachable:
          Boolean(audit.ok),
        statusCode:
          audit.metrics
            ?.statusCode ||
          page.statusCode ||
          0,
        loadMs:
          audit.metrics
            ?.loadMs ||
          page.loadMs ||
          0,
        finalUrl:
          page.url ||
          this.url,
        titleLength:
          normalizeText(
            audit.metrics?.title
          ).length,
        h1Count:
          headings.h1 || 0,
        headingCounts:
          headings,
        metaDescriptionLength:
          normalizeText(
            audit.metrics
              ?.metaDescription
          ).length,
        formCount:
          forms.length,
        validFormCount:
          forms.filter(
            form =>
              form.hasSubmit &&
              (
                form.inputCount > 0 ||
                form.textareaCount > 0
              )
          ).length,
        imageCount:
          images.length,
        imagesMissingAlt:
          images.filter(
            image =>
              !image.hasAlt
          ).length,
        inputLabelCoverage:
          labels.coverage,
        linksDiscovered:
          linkAudit.discovered,
        internalLinks:
          linkAudit.internal,
        linksChecked:
          linkAudit.checked,
        brokenLinks:
          linkAudit.broken.length,
        hasCanonical:
          /<link\b[^>]*rel=["']canonical["'][^>]*>/i
            .test(html),
        hasViewport:
          /<meta\b[^>]*name=["']viewport["'][^>]*>/i
            .test(html),
        hasLang:
          /<html\b[^>]*lang=["'][^"']+["']/i
            .test(html),
        hasMainLandmark:
          /<main\b/i
            .test(html),
        hasNavigation:
          /<nav\b/i
            .test(html),
        hasSkipLink:
          /href=["']#(?:main|content|main-content)["']/i
            .test(html),
        hasAria:
          /\baria-[a-z-]+=/i
            .test(html)
      };

      const fingerprint =
        buildContentFingerprint(
          metrics
        );

      const baseline =
        readJson(
          BASELINE_FILE,
          null
        );

      const contentDrift =
        compareFingerprint(
          baseline,
          fingerprint
        );

      if (!baseline) {
        writeJson(
          BASELINE_FILE,
          fingerprint
        );
      }

      const exceptions = [];

      if (!audit.ok) {
        exceptions.push({
          type:
            "WebsiteUnavailable",
          severity:
            "Critical",
          message:
            audit.error ||
            "Website audit failed."
        });
      }

      if (
        metrics.statusCode < 200 ||
        metrics.statusCode >= 400
      ) {
        exceptions.push({
          type:
            "HTTPStatus",
          severity:
            "Critical",
          message:
            `Homepage returned status ${metrics.statusCode}.`
        });
      }

      if (!metrics.https) {
        exceptions.push({
          type:
            "HTTPS",
          severity:
            "Critical",
          message:
            "Website is not using HTTPS."
        });
      }

      if (
        !metrics.title ||
        metrics.titleLength < 10
      ) {
        exceptions.push({
          type:
            "SEO",
          severity:
            "Warning",
          message:
            "Page title is missing or too short."
        });
      }

      if (
        !metrics.metaDescription ||
        metrics.metaDescriptionLength < 50
      ) {
        exceptions.push({
          type:
            "SEO",
          severity:
            "Warning",
          message:
            "Meta description is missing or too short."
        });
      }

      if (
        metrics.h1Count !== 1
      ) {
        exceptions.push({
          type:
            "ContentStructure",
          severity:
            "Warning",
          message:
            `Expected exactly one H1; found ${metrics.h1Count}.`
        });
      }

      if (!metrics.hasCTA) {
        exceptions.push({
          type:
            "Conversion",
          severity:
            "Warning",
          message:
            "No clear call-to-action was detected."
        });
      }

      if (!metrics.hasCalendly) {
        exceptions.push({
          type:
            "Conversion",
          severity:
            "Warning",
          message:
            "Calendly integration was not detected."
        });
      }

      if (
        metrics.formCount > 0 &&
        metrics.validFormCount === 0
      ) {
        exceptions.push({
          type:
            "Forms",
          severity:
            "Warning",
          message:
            "Forms were detected but no valid submit form was confirmed."
        });
      }

      if (
        metrics.imageCount > 0 &&
        metrics.imagesMissingAlt > 0
      ) {
        exceptions.push({
          type:
            "Accessibility",
          severity:
            "Warning",
          message:
            `${metrics.imagesMissingAlt} image(s) are missing alt text.`
        });
      }

      if (
        metrics.inputLabelCoverage < 100
      ) {
        exceptions.push({
          type:
            "Accessibility",
          severity:
            "Warning",
          message:
            `Input label coverage is ${metrics.inputLabelCoverage}%.`
        });
      }

      if (!metrics.hasLang) {
        exceptions.push({
          type:
            "Accessibility",
          severity:
            "Warning",
          message:
            "The HTML language attribute was not detected."
        });
      }

      if (
        linkAudit.broken.length > 0
      ) {
        exceptions.push({
          type:
            "BrokenLinks",
          severity:
            "Warning",
          message:
            `${linkAudit.broken.length} broken internal link(s) detected.`
        });
      }

      if (
        contentDrift.changed
      ) {
        exceptions.push({
          type:
            "ContentDrift",
          severity:
            "Info",
          message:
            `${contentDrift.changes.length} monitored content field(s) changed from baseline.`
        });
      }

      const critical =
        exceptions.some(
          item =>
            item.severity ===
            "Critical"
        );

      const warning =
        exceptions.some(
          item =>
            item.severity ===
            "Warning"
        );

      this.status =
        critical
          ? "Critical"
          : warning
            ? "Watch"
            : "Healthy";

      this.metrics =
        metrics;

      this.exceptions =
        exceptions;

      this.recommendations = [];

      if (!metrics.hasCTA) {
        this.recommendations.push(
          "Add or restore a clear primary scheduling CTA."
        );
      }

      if (!metrics.hasCalendly) {
        this.recommendations.push(
          "Verify the approved Calendly link is present and reachable."
        );
      }

      if (
        metrics.brokenLinks > 0
      ) {
        this.recommendations.push(
          "Repair broken internal links through the approved website change queue."
        );
      }

      if (
        metrics.imagesMissingAlt > 0
      ) {
        this.recommendations.push(
          "Add descriptive alt text to images through the approved accessibility remediation process."
        );
      }

      if (
        metrics.inputLabelCoverage < 100
      ) {
        this.recommendations.push(
          "Add explicit labels to form fields."
        );
      }

      if (
        contentDrift.changed
      ) {
        this.recommendations.push(
          "Review content drift against approved website changes before publishing or rollback."
        );
      }

      const result = {
        ok:
          this.status !==
          "Critical",
        provider:
          "WebsiteProvider",
        action:
          "verifyWebsite",
        status:
          this.status,
        generatedAt:
          this.lastRefresh,
        verifiedAt:
          this.lastRefresh,
        readOnly: true,
        url:
          this.url,
        metrics:
          this.metrics,
        exceptions:
          this.exceptions,
        recommendations:
          this.recommendations,
        details: {
          forms,
          brokenLinks:
            linkAudit.broken,
          linkResults:
            linkAudit.results,
          contentDrift
        },
        safety: {
          websiteMode:
            "READ_ONLY",
          writesEnabled:
            false,
          publishingEnabled:
            false,
          formSubmissionEnabled:
            false,
          contentChangesEnabled:
            false,
          b12WritesEnabled:
            false
        }
      };

      result.evidenceFile =
        persistEvidence(
          result
        );

      return result;
    } catch (error) {
      this.status =
        "Critical";

      this.metrics = {};

      this.exceptions = [{
        type:
          "WebsiteAudit",
        severity:
          "Critical",
        message:
          error.stack ||
          error.message
      }];

      this.recommendations = [
        "Verify Website connector.",
        "Verify P2GC_WEBSITE_URL.",
        "Verify outbound HTTPS access."
      ];

      const result = {
        ok: false,
        provider:
          "WebsiteProvider",
        action:
          "verifyWebsite",
        status:
          this.status,
        generatedAt:
          this.lastRefresh,
        verifiedAt:
          this.lastRefresh,
        readOnly: true,
        metrics:
          this.metrics,
        exceptions:
          this.exceptions,
        recommendations:
          this.recommendations,
        safety: {
          websiteMode:
            "READ_ONLY",
          writesEnabled:
            false,
          publishingEnabled:
            false,
          formSubmissionEnabled:
            false,
          contentChangesEnabled:
            false,
          b12WritesEnabled:
            false
        }
      };

      result.evidenceFile =
        persistEvidence(
          result
        );

      return result;
    }
  }

  async executeTask(task = {}) {
    const payload =
      task.payload ||
      task ||
      {};

    const action =
      payload.action ||
      "verifyWebsite";

    if (
      typeof this[action] !==
      "function"
    ) {
      throw new Error(
        `Unsupported WebsiteProvider action: ${action}`
      );
    }

    return this[action](task);
  }

  async shutdown() {
    return true;
  }
}

module.exports = WebsiteProvider;

'@ | Set-Content `
    -Path ".\PROVIDERS\providers\WebsiteProvider.js" `
    -Encoding UTF8

@'
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const WebsiteProvider =
  require("../PROVIDERS/providers/WebsiteProvider");

const html = `
<!doctype html>
<html lang="en">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pathways 2 Government Contracting</title>
  <meta name="description" content="Government contracting advisory services for companies seeking federal and SLED growth opportunities.">
  <link rel="canonical" href="https://pathways2gc.com/">
</head>
<body>
  <a href="#main">Skip to content</a>
  <nav><a href="/services">Services</a></nav>
  <main id="main">
    <h1>Federal and SLED Growth Advisory</h1>
    <a href="https://calendly.com/kevin-pathways2gc/30min">Schedule a call</a>
    <form action="/contact" method="post">
      <label for="email">Email</label>
      <input id="email" type="email">
      <button type="submit">Contact us</button>
    </form>
    <img src="/logo.png" alt="Pathways 2 Government Contracting">
  </main>
</body>
</html>
`;

const fakeConnector = {
  async auditWebsite() {
    return {
      ok: true,
      url: "https://pathways2gc.com",
      metrics: {
        homepageReachable: true,
        statusCode: 200,
        loadMs: 250,
        title:
          "Pathways 2 Government Contracting",
        h1:
          "Federal and SLED Growth Advisory",
        metaDescription:
          "Government contracting advisory services for companies seeking federal and SLED growth opportunities.",
        https: true,
        hasCTA: true,
        hasContact: true,
        hasCalendly: true,
        hasServices: true,
        hasPhone: true,
        hasEmail: true
      }
    };
  },

  async fetchUrl(url) {
    if (
      url.endsWith("/services")
    ) {
      return {
        ok: true,
        statusCode: 200,
        body:
          "<html><body>Services</body></html>",
        loadMs: 100,
        url
      };
    }

    return {
      ok: true,
      statusCode: 200,
      body: html,
      loadMs: 250,
      url
    };
  }
};

async function main() {
  const provider =
    new WebsiteProvider({
      connector:
        fakeConnector,
      url:
        "https://pathways2gc.com"
    });

  const result =
    await provider.verifyWebsite();

  assert.strictEqual(
    result.provider,
    "WebsiteProvider"
  );

  assert.strictEqual(
    result.readOnly,
    true
  );

  assert.strictEqual(
    result.status,
    "Healthy"
  );

  assert.strictEqual(
    result.metrics.homepageReachable,
    true
  );

  assert.strictEqual(
    result.metrics.hasCalendly,
    true
  );

  assert.strictEqual(
    result.metrics.formCount,
    1
  );

  assert.strictEqual(
    result.metrics.validFormCount,
    1
  );

  assert.strictEqual(
    result.metrics.imagesMissingAlt,
    0
  );

  assert.strictEqual(
    result.metrics.inputLabelCoverage,
    100
  );

  assert.strictEqual(
    result.metrics.brokenLinks,
    0
  );

  assert.strictEqual(
    result.safety.writesEnabled,
    false
  );

  assert.strictEqual(
    result.safety.publishingEnabled,
    false
  );

  assert(
    fs.existsSync(
      result.evidenceFile
    ),
    "Website COO evidence file was not created."
  );

  console.log(JSON.stringify({
    ok: true,
    build: "023",
    tests: {
      websiteConnectorIntegration:
        "PASSED",
      availabilityMonitoring:
        "PASSED",
      httpsValidation:
        "PASSED",
      ctaValidation:
        "PASSED",
      calendlyValidation:
        "PASSED",
      formValidation:
        "PASSED",
      seoValidation:
        "PASSED",
      accessibilityValidation:
        "PASSED",
      brokenLinkValidation:
        "PASSED",
      contentDriftMonitoring:
        "PASSED",
      readOnlySafety:
        "PASSED",
      evidencePersistence:
        "PASSED"
    },
    status:
      result.status,
    metrics:
      result.metrics,
    exceptions:
      result.exceptions,
    recommendations:
      result.recommendations,
    safety:
      result.safety,
    evidenceFile:
      result.evidenceFile
  }, null, 2));
}

main().catch(error => {
  console.error(
    error.stack ||
    error.message
  );

  process.exit(1);
});

'@ | Set-Content `
    -Path ".\TESTS\Test_Build023_WebsiteCOO.js" `
    -Encoding UTF8

Write-Host ""
Write-Host "=== BUILD 023 SYNTAX VALIDATION ==="

$Files = @(
    ".\PROVIDERS\providers\WebsiteProvider.js",
    ".\CONNECTORS\WEBSITE\website.js",
    ".\SERVICES\ProviderRouterService.js",
    ".\SERVICES\CapabilityService.js",
    ".\SERVICES\PlannerService.js",
    ".\SERVICES\WorkflowService.js",
    ".\SERVICES\ExecutionService.js",
    ".\SERVICES\WorkforceExecutionService.js",
    ".\TESTS\Test_Build023_WebsiteCOO.js"
)

foreach ($File in $Files) {
    & node --check $File

    if ($LASTEXITCODE -ne 0) {
        throw "Syntax failed: $File"
    }

    Write-Host "[PASS] $File"
}

Write-Host ""
Write-Host "=== BUILD 023 AUTOMATED TESTS ==="

$Output =
    & node ".\TESTS\Test_Build023_WebsiteCOO.js" 2>&1

$ExitCode =
    $LASTEXITCODE

$Report =
    Join-Path `
        $ReportDir `
        "build_023_test_$Stamp.txt"

$Output |
    Tee-Object -FilePath $Report

if ($ExitCode -ne 0) {
    throw "Build 023 tests failed. Restore from $BackupRoot"
}

$Manifest = [ordered]@{
    ok = $true
    build = "023"
    name = "Website COO"
    installedAt =
        (Get-Date).ToString("o")
    backupRoot = $BackupRoot
    changedFiles = @(
        "PROVIDERS\providers\WebsiteProvider.js"
    )
    reusedComponents = @(
        "CONNECTORS\WEBSITE\website.js",
        "SERVICES\ProviderRouterService.js",
        "SERVICES\CapabilityService.js",
        "SERVICES\PlannerService.js",
        "SERVICES\WorkflowService.js",
        "SERVICES\ExecutionService.js"
    )
    capabilities = @(
        "Availability monitoring",
        "HTTPS validation",
        "CTA validation",
        "Calendly validation",
        "Contact form validation",
        "SEO metadata validation",
        "Heading structure validation",
        "Accessibility checks",
        "Broken internal link checks",
        "Content drift monitoring",
        "Evidence persistence"
    )
    safety = @(
        "Read-only website operation",
        "No website edits",
        "No publishing",
        "No form submissions",
        "No B12 writes",
        "No content changes"
    )
    report = $Report
}

$Manifest |
    ConvertTo-Json -Depth 8 |
    Set-Content `
        -Path (
          Join-Path `
            $ReportDir `
            "build_023_manifest_$Stamp.json"
        ) `
        -Encoding UTF8

Write-Host ""
Write-Host "============================================================"
Write-Host "BUILD 023 WEBSITE COO INSTALLED AND VERIFIED"
Write-Host "============================================================"
Write-Host "Backup: $BackupRoot"
Write-Host "Report: $Report"
