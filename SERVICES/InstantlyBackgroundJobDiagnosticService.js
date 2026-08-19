'use strict';

/*
  MILES Enterprise
  P1.5F3 — Instantly background move-job diagnostic
  READ ONLY. Inspects live background-job status before any further dedup mutation.
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ROOT = process.cwd();
const BASE_URL = process.env.INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2';
const OUTPUT = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION', 'INSTANTLY_BACKGROUND_JOB_DIAGNOSTIC_LATEST.json');

function headers() {
  const apiKey = process.env.INSTANTLY_API_KEY || '';
  if (!apiKey) throw new Error('INSTANTLY_API_KEY is not configured.');
  return { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
}

async function listJobs() {
  const r = await axios({
    method: 'GET',
    url: `${BASE_URL}/background-jobs`,
    headers: headers(),
    params: {
      limit: 100,
      type: 'move-leads',
      sort_column: 'created_at',
      sort_order: 'desc'
    },
    timeout: 30000,
    validateStatus: s => s >= 200 && s < 300
  });
  return Array.isArray(r.data?.items) ? r.data.items : [];
}

function ageMinutes(ts) {
  const t = Date.parse(ts || '');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

async function run() {
  const jobs = await listJobs();
  const normalized = jobs.map(j => ({
    id: j.id,
    type: j.type,
    status: j.status,
    progress: Number(j.progress || 0),
    createdAt: j.created_at || null,
    updatedAt: j.updated_at || null,
    ageMinutes: ageMinutes(j.created_at),
    minutesSinceUpdate: ageMinutes(j.updated_at),
    entityId: j.entity_id || null,
    entityType: j.entity_type || null,
    data: j.data || {}
  }));

  const counts = { pending: 0, inProgress: 0, success: 0, failed: 0, other: 0 };
  for (const j of normalized) {
    if (j.status === 'pending') counts.pending++;
    else if (j.status === 'in-progress') counts.inProgress++;
    else if (j.status === 'success') counts.success++;
    else if (j.status === 'failed') counts.failed++;
    else counts.other++;
  }

  const stuck = normalized.filter(j => ['pending','in-progress'].includes(j.status) && Number(j.minutesSinceUpdate || 0) >= 15);
  const recentFailed = normalized.filter(j => j.status === 'failed');
  const result = {
    ok: true,
    gate: 'P1.5F3_INSTANTLY_BACKGROUND_MOVE_JOB_DIAGNOSTIC',
    generatedAt: new Date().toISOString(),
    jobsObserved: normalized.length,
    counts,
    stuckJobCount: stuck.length,
    recentFailedCount: recentFailed.length,
    stuckJobs: stuck,
    failedJobs: recentFailed,
    jobs: normalized,
    assessment: stuck.length > 0
      ? 'BACKGROUND_MOVE_JOBS_STUCK_OR_NOT_PROGRESSING'
      : (counts.pending + counts.inProgress > 0)
        ? 'BACKGROUND_MOVE_JOBS_STILL_ACTIVE'
        : recentFailed.length > 0
          ? 'BACKGROUND_MOVE_JOBS_FAILED_REVIEW_REQUIRED'
          : 'BACKGROUND_MOVE_JOBS_SETTLED',
    nextAction: stuck.length > 0
      ? 'DO_NOT_RESUBMIT_DEDUP; INSPECT FAILED_OR_STUCK_JOB_DETAILS'
      : (counts.pending + counts.inProgress > 0)
        ? 'WAIT_AND_RECHECK_JOB_STATUS'
        : recentFailed.length > 0
          ? 'REPAIR_FAILED_JOB_CAUSE_BEFORE_RETRY'
          : 'RERUN_P1_5F_POST_REPAIR_GATE',
    safety: {
      readOnly: true,
      submitMoveJobs: false,
      activateCampaigns: false,
      updateCampaigns: false,
      deleteLeads: false,
      deleteCampaigns: false,
      sendReplies: false
    },
    outputFile: OUTPUT
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { run };
