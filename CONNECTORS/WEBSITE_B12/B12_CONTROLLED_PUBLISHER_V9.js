'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const V8Publisher = require('./B12_CONTROLLED_PUBLISHER_V8');
const BasePublisher = require('./B12_CONTROLLED_PUBLISHER');
const { envBool } = BasePublisher.helpers;

function clean(v) { return String(v || '').trim(); }
function promptHash(op) {
  return crypto.createHash('sha256').update(JSON.stringify({
    id: clean(op?.id),
    target: clean(op?.target),
    prompt: clean(op?.prompt)
  })).digest('hex');
}

class B12ControlledPublisherV9 extends V8Publisher {
  successLedgerFile() {
    return path.join(this.outputDir, 'successful_operations.json');
  }

  readLedger() {
    const file = this.successLedgerFile();
    if (!fs.existsSync(file)) return { site: this.manifest.site, operations: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      if (parsed?.site !== this.manifest.site || typeof parsed.operations !== 'object' || !parsed.operations) {
        return { site: this.manifest.site, operations: {} };
      }
      return parsed;
    } catch {
      return { site: this.manifest.site, operations: {} };
    }
  }

  seedIds() {
    return clean(process.env.B12_CONFIRMED_SUCCESSFUL_OPERATION_SEED)
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);
  }

  loadResumeState() {
    if (!envBool('B12_RESUME_SUCCESSFUL_OPERATIONS', false)) return null;

    const ledger = this.readLedger();
    const currentOps = new Map((this.manifest.operations || []).map(op => [op.id, op]));
    const successful = new Map();

    for (const [id, saved] of Object.entries(ledger.operations || {})) {
      const current = currentOps.get(id);
      if (!current) continue;
      if (saved?.promptHash !== promptHash(current)) continue;
      successful.set(id, {
        id,
        target: current.target,
        result: {
          ok: true,
          status: 'RESUMED_FROM_DURABLE_SUCCESS_LEDGER',
          priorStatus: saved.priorStatus || saved.status || null
        },
        durable: true
      });
    }

    for (const id of this.seedIds()) {
      const current = currentOps.get(id);
      if (!current || successful.has(id)) continue;
      successful.set(id, {
        id,
        target: current.target,
        result: {
          ok: true,
          status: 'CONFIRMED_SUCCESS_MIGRATION_FROM_PRIOR_LIVE_EVIDENCE',
          priorStatus: 'PRIOR_LIVE_OPERATION_CONFIRMED_GREEN'
        },
        migrated: true
      });
    }

    if (!successful.size) return null;
    return {
      file: fs.existsSync(this.successLedgerFile()) ? this.successLedgerFile() : 'B12_CONFIRMED_SUCCESSFUL_OPERATION_SEED',
      prior: { generatedAt: ledger.updatedAt || new Date().toISOString() },
      successful
    };
  }

  persistDurableSuccesses(result) {
    if (!result || !Array.isArray(result.operations)) return null;
    const ledger = this.readLedger();
    ledger.site = this.manifest.site;
    ledger.version = '1.0.0';
    ledger.updatedAt = new Date().toISOString();
    ledger.operations = ledger.operations || {};

    const currentOps = new Map((this.manifest.operations || []).map(op => [op.id, op]));
    for (const completed of result.operations) {
      if (completed?.result?.ok !== true || !completed.id) continue;
      const current = currentOps.get(completed.id);
      if (!current) continue;
      ledger.operations[completed.id] = {
        id: completed.id,
        target: current.target || null,
        promptHash: promptHash(current),
        confirmedAt: new Date().toISOString(),
        priorStatus: completed.result.status || null,
        provenance: completed.resumed ? 'RESUMED_OR_MIGRATED_SUCCESS' : 'LIVE_B12_OPERATION_SUCCESS'
      };
    }

    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(this.successLedgerFile(), JSON.stringify(ledger, null, 2), 'utf8');
    return ledger;
  }

  async run(options = {}) {
    const result = await super.run(options);
    const ledger = this.persistDurableSuccesses(result);
    if (result) {
      result.publisherVersion = 'V9_DURABLE_RESUME_TWO_PHASE_PAGE_BUILD';
      result.promptStrategy = 'TWO_PHASE_SCAFFOLD_THEN_CONTENT_WITH_DURABLE_SUCCESS_LEDGER';
      result.durableResume = {
        enabled: envBool('B12_RESUME_SUCCESSFUL_OPERATIONS', false),
        ledgerFile: this.successLedgerFile(),
        seededOperationIds: this.seedIds(),
        retainedOperationIds: Object.keys(ledger?.operations || {})
      };
      try {
        const file = result.outputFile || this.latestReportFile();
        if (file) fs.writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');
      } catch {}
    }
    return result;
  }
}

if (require.main === module) {
  const publisher = new B12ControlledPublisherV9();
  const apply = envBool('P2GC_B12_APPLY', false);
  const publish = envBool('P2GC_B12_PUBLISH', false);
  publisher.run({ apply, publish }).then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  }).catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = B12ControlledPublisherV9;
