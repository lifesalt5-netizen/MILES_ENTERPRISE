'use strict';

const fs = require('fs');
const path = require('path');
const V4Publisher = require('./B12_CONTROLLED_PUBLISHER_V4');
const BasePublisher = require('./B12_CONTROLLED_PUBLISHER');
const { envBool } = BasePublisher.helpers;
const { detectSession } = require('./modules/session');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clean(v) { return String(v || '').trim(); }

class B12ControlledPublisherV5 extends V4Publisher {
  operationTimeoutMs(prompt) {
    const text = clean(prompt);
    if (/Create or update a page named/i.test(text)) return 8 * 60 * 1000;
    if (/Clean up legacy P2GC positioning/i.test(text)) return 5 * 60 * 1000;
    return 4 * 60 * 1000;
  }

  async sendAgentPrompt(prompt) {
    const opened = await this.openAgent();
    if (!opened.ok) return opened;
    const { input, scope } = opened;

    try {
      await input.fill(prompt);
    } catch {
      await input.click();
      await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => null);
      await input.press('Backspace').catch(() => null);
      await input.type(prompt);
    }

    const send = await this.findSubmitButton(scope, input);
    if (send) await send.click();
    else await input.press('Enter');

    const timeoutMs = this.operationTimeoutMs(prompt);
    const settled = await this.waitForAgentSettled(timeoutMs);
    return {
      ...settled,
      timeoutMs,
      inputScopeUrl: opened.scopeUrl || ''
    };
  }

  latestReportFile() {
    return path.join(this.outputDir, 'latest.json');
  }

  loadResumeState() {
    if (!envBool('B12_RESUME_SUCCESSFUL_OPERATIONS', false)) return null;
    const file = this.latestReportFile();
    if (!fs.existsSync(file)) return null;

    try {
      const prior = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const generatedAtMs = Date.parse(prior.generatedAt || '');
      const fresh = Number.isFinite(generatedAtMs) && (Date.now() - generatedAtMs) >= 0 && (Date.now() - generatedAtMs) <= 12 * 60 * 60 * 1000;
      if (!fresh) return null;
      if (prior.site !== this.manifest.site) return null;
      if (prior.requestedApply !== true) return null;
      if (prior.publicPublishExecuted === true) return null;
      if (!Array.isArray(prior.operations)) return null;

      const successful = new Map();
      for (const op of prior.operations) {
        if (op?.result?.ok === true && op.id) successful.set(op.id, op);
      }
      if (!successful.size) return null;
      return { file, prior, successful };
    } catch {
      return null;
    }
  }

  async run(options = {}) {
    const requestedApply = options.apply === true;
    const requestedPublish = options.publish === true;
    const resume = this.loadResumeState();
    const report = {
      ok: false,
      service: 'B12_CONTROLLED_PUBLISHER',
      publisherVersion: 'V5_RESUMABLE_LONG_AGENT',
      site: this.manifest.site,
      generatedAt: new Date().toISOString(),
      requestedApply,
      requestedPublish,
      gates: this.gates(),
      operations: [],
      mutationExecuted: false,
      mutationAttempted: false,
      publicPublishExecuted: false,
      resume: {
        enabled: envBool('B12_RESUME_SUCCESSFUL_OPERATIONS', false),
        sourceFile: resume?.file || null,
        priorSuccessfulOperationIds: resume ? [...resume.successful.keys()] : []
      }
    };

    try {
      await this.open();
      report.session = await detectSession(this.page);
      report.beforeScreenshot = await this.screenshot('before');
      report.ui = await this.uiInventory();
      if (!report.session.loggedIn) {
        report.status = 'AUTHENTICATED_B12_SESSION_REQUIRED';
        return report;
      }

      const body = report.ui.bodyPreview || '';
      report.editorMode = /AI Agent/i.test(body) ? 'B12_AI_AGENT_EDITOR' : /Website|Pages|Editor/i.test(body) ? 'B12_EDITOR_UNKNOWN_VERSION' : 'B12_EDITOR_UNRESOLVED';

      if (!requestedApply || !this.mayEdit()) {
        report.ok = true;
        report.status = 'CONTROLLED_DRY_RUN';
        report.plan = (this.manifest.operations || []).map(op => ({ id: op.id, target: op.target, prompt: op.prompt }));
        return report;
      }

      for (const op of this.manifest.operations || []) {
        const priorOp = resume?.successful.get(op.id);
        if (priorOp) {
          report.operations.push({
            id: op.id,
            target: op.target,
            resumed: true,
            resumedFromGeneratedAt: resume.prior.generatedAt || null,
            result: {
              ok: true,
              status: 'RESUMED_FROM_PRIOR_SUCCESSFUL_OPERATION',
              priorStatus: priorOp.result?.status || null
            }
          });
          continue;
        }

        const before = await this.screenshot(`before_${op.id}`);
        report.mutationAttempted = true;
        const result = await this.sendAgentPrompt(op.prompt);
        const after = await this.screenshot(`after_${op.id}`);
        report.operations.push({ id: op.id, target: op.target, before, after, result });
        if (!result.ok) {
          report.status = `EDIT_FAILED_${op.id}`;
          return report;
        }
        report.mutationExecuted = true;
        await sleep(1500);
      }

      report.staging = await this.verifyStaging();
      if (!report.staging.ok) {
        report.status = 'STAGING_VERIFICATION_FAILED_NO_PUBLIC_PUBLISH';
        return report;
      }

      if (!requestedPublish || !this.mayPublish()) {
        report.ok = true;
        report.status = 'STAGING_VERIFIED_PUBLIC_PUBLISH_NOT_REQUESTED_OR_GATED';
        return report;
      }

      report.publish = await this.publish();
      report.publicPublishExecuted = report.publish.mutationExecuted === true;
      report.status = report.publish.ok ? 'PUBLIC_PUBLISH_SUBMITTED' : report.publish.status;
      report.ok = report.publish.ok === true;
      report.afterScreenshot = await this.screenshot('after_publish');
      return report;
    } catch (error) {
      report.status = 'B12_CONTROLLED_PUBLISHER_EXCEPTION';
      report.error = error.message;
      return report;
    } finally {
      fs.mkdirSync(this.outputDir, { recursive: true });
      const file = this.latestReportFile();
      report.outputFile = file;
      fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
      await this.close();
    }
  }
}

async function main() {
  const publisher = new B12ControlledPublisherV5();
  const apply = envBool('P2GC_B12_APPLY', false);
  const publish = envBool('P2GC_B12_PUBLISH', false);
  const result = await publisher.run({ apply, publish });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1); });
}

module.exports = B12ControlledPublisherV5;
