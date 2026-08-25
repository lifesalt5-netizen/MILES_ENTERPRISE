'use strict';

const V5Publisher = require('./B12_CONTROLLED_PUBLISHER_V5');
const BasePublisher = require('./B12_CONTROLLED_PUBLISHER');
const { envBool } = BasePublisher.helpers;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clean(v) { return String(v || '').trim(); }

class B12ControlledPublisherV6 extends V5Publisher {
  operationTimeoutMs(prompt) {
    const text = clean(prompt);
    if (/Create or update a page named/i.test(text)) return 20 * 60 * 1000;
    if (/Clean up legacy P2GC positioning/i.test(text)) return 10 * 60 * 1000;
    return 8 * 60 * 1000;
  }

  async waitForAgentSettled(timeoutMs = 20 * 60 * 1000) {
    const started = Date.now();
    let lastTail = '';
    let stable = 0;
    let lastHeartbeatBucket = -1;
    let lastChangeAt = started;

    while (Date.now() - started < timeoutMs) {
      await sleep(2500);
      const body = await this.combinedEditorText();
      const tail = body.slice(-12000);
      const working = /thinking|working on it|making changes|generating|updating your site|writing code|applying changes/i.test(tail);

      if (tail !== lastTail) lastChangeAt = Date.now();
      if (!working && tail && tail === lastTail) stable += 1;
      else stable = 0;
      lastTail = tail;

      const elapsedMs = Date.now() - started;
      const heartbeatBucket = Math.floor(elapsedMs / 60000);
      if (heartbeatBucket !== lastHeartbeatBucket) {
        lastHeartbeatBucket = heartbeatBucket;
        console.log(`[B12_AGENT_PROGRESS] elapsed=${Math.round(elapsedMs / 1000)}s working=${working} stable=${stable} lastChangeAgo=${Math.round((Date.now() - lastChangeAt) / 1000)}s`);
      }

      if (stable >= 2) {
        return {
          ok: true,
          status: 'AGENT_SETTLED_PROGRESS_AWARE',
          elapsedMs,
          workingAtCompletion: false
        };
      }
    }

    const finalBody = await this.combinedEditorText().catch(() => '');
    const finalTail = finalBody.slice(-12000);
    const stillWorking = /thinking|working on it|making changes|generating|updating your site|writing code|applying changes/i.test(finalTail);
    return {
      ok: false,
      status: stillWorking ? 'AGENT_STILL_WORKING_AT_MAX_WAIT' : 'AGENT_SETTLE_TIMEOUT_NO_STABLE_COMPLETION',
      timeoutMs,
      stillWorking,
      elapsedMs: Date.now() - started,
      lastChangeAgoMs: Date.now() - lastChangeAt
    };
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
    console.log(`[B12_AGENT_OPERATION_STARTED] timeoutMs=${timeoutMs}`);
    const settled = await this.waitForAgentSettled(timeoutMs);
    return {
      ...settled,
      timeoutMs,
      inputScopeUrl: opened.scopeUrl || ''
    };
  }

  async run(options = {}) {
    const result = await super.run(options);
    if (result && result.publisherVersion === 'V5_RESUMABLE_LONG_AGENT') {
      result.publisherVersion = 'V6_RESUMABLE_PROGRESS_AWARE_AGENT';
      try {
        const fs = require('fs');
        const file = result.outputFile || this.latestReportFile();
        if (file) fs.writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');
      } catch {}
    }
    return result;
  }
}

async function main() {
  const publisher = new B12ControlledPublisherV6();
  const apply = envBool('P2GC_B12_APPLY', false);
  const publish = envBool('P2GC_B12_PUBLISH', false);
  const result = await publisher.run({ apply, publish });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1); });
}

module.exports = B12ControlledPublisherV6;
