'use strict';

const fs = require('fs');
const V10Publisher = require('./B12_CONTROLLED_PUBLISHER_V10');
const BasePublisher = require('./B12_CONTROLLED_PUBLISHER');
const { envBool } = BasePublisher.helpers;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function hasWorkingSignal(text) {
  return /thinking|working on it|making changes|generating|updating your site|writing code|applying changes/i.test(String(text || ''));
}

function hasExplicitCompletion(text) {
  return /\bI(?:'ve| have)? (?:created|updated|added|removed)\b|\bI created a new page called\b|\b(?:page|changes?) (?:is|are) (?:ready|complete|completed|updated|created)\b/i.test(String(text || ''));
}

class B12ControlledPublisherV11 extends V10Publisher {
  async waitForAgentSettled(timeoutMs = 15 * 60 * 1000) {
    const started = Date.now();
    let firstTail = null;
    let lastTail = '';
    let stable = 0;
    let explicitStable = 0;
    let lastHeartbeatBucket = -1;
    let lastChangeAt = started;
    let sawWorking = false;
    let sawPostStartChange = false;

    while (Date.now() - started < timeoutMs) {
      await sleep(2500);
      const body = await this.combinedEditorText();
      const tail = body.slice(-12000);
      const recent = tail.slice(-3000);
      const workingRecent = hasWorkingSignal(recent);
      const workingHistorical = hasWorkingSignal(tail);
      const explicitCompletion = hasExplicitCompletion(recent);

      if (firstTail === null) firstTail = tail;
      else if (tail !== firstTail) sawPostStartChange = true;

      if (workingRecent) sawWorking = true;
      if (tail !== lastTail) lastChangeAt = Date.now();

      const elapsedMs = Date.now() - started;
      const noVisibleProgressMs = Date.now() - lastChangeAt;
      const activityObserved = sawWorking || sawPostStartChange || elapsedMs >= 30000;

      if (!workingRecent && tail && tail === lastTail && activityObserved) stable += 1;
      else stable = 0;

      if (explicitCompletion && !workingRecent && activityObserved) explicitStable += 1;
      else explicitStable = 0;

      lastTail = tail;

      const heartbeatBucket = Math.floor(elapsedMs / 60000);
      if (heartbeatBucket !== lastHeartbeatBucket) {
        lastHeartbeatBucket = heartbeatBucket;
        console.log(`[B12_AGENT_PROGRESS] elapsed=${Math.round(elapsedMs / 1000)}s workingRecent=${workingRecent} workingHistorical=${workingHistorical} explicitCompletion=${explicitCompletion} stable=${stable} lastChangeAgo=${Math.round(noVisibleProgressMs / 1000)}s`);
      }

      if (explicitStable >= 2) {
        return {
          ok: true,
          status: 'AGENT_EXPLICIT_PROVIDER_COMPLETION',
          elapsedMs,
          workingAtCompletion: false,
          completionEvidence: recent.slice(-1800)
        };
      }

      if (stable >= 2) {
        return {
          ok: true,
          status: 'AGENT_SETTLED_RECENT_ACTIVITY_AWARE',
          elapsedMs,
          workingAtCompletion: false,
          historicalWorkingSignalIgnored: workingHistorical && !workingRecent
        };
      }

      if (workingRecent && noVisibleProgressMs >= 10 * 60 * 1000) {
        return {
          ok: false,
          status: 'AGENT_STALLED_RECENT_WORKING_SIGNAL',
          stillWorking: true,
          elapsedMs,
          lastChangeAgoMs: noVisibleProgressMs,
          stallThresholdMs: 10 * 60 * 1000,
          providerDiagnostics: {
            workingRecent,
            workingHistorical,
            explicitCompletion,
            taskListMentioned: /task list/i.test(tail),
            aiFixMentioned: /ai fix|fix with ai/i.test(tail),
            tailPreview: tail.slice(-3000)
          }
        };
      }
    }

    return {
      ok: false,
      status: 'AGENT_COMPLETION_AWARE_MAX_WAIT',
      timeoutMs,
      elapsedMs: Date.now() - started,
      lastChangeAgoMs: Date.now() - lastChangeAt,
      providerDiagnostics: {
        workingRecent: hasWorkingSignal(lastTail.slice(-3000)),
        workingHistorical: hasWorkingSignal(lastTail),
        explicitCompletion: hasExplicitCompletion(lastTail.slice(-3000)),
        taskListMentioned: /task list/i.test(lastTail),
        aiFixMentioned: /ai fix|fix with ai/i.test(lastTail),
        tailPreview: lastTail.slice(-3000)
      }
    };
  }

  async run(options = {}) {
    const result = await super.run(options);
    if (result) {
      result.publisherVersion = 'V11_DURABLE_RESUME_COMPLETION_AWARE';
      result.promptStrategy = 'ATOMIC_PAGE_CREATE_WITH_RECENT_ACTIVITY_AND_EXPLICIT_COMPLETION_DETECTION';
      result.completionPolicy = {
        recentWorkingWindowChars: 3000,
        historicalWorkingTextDoesNotBlockCompletion: true,
        explicitProviderCompletionAccepted: true,
        durableSuccessLedgerRetained: true
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
  const publisher = new B12ControlledPublisherV11();
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

module.exports = B12ControlledPublisherV11;
