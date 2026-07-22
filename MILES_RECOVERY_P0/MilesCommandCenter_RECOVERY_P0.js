'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const DigitalCOOHost = require('./DigitalCOOHost');
const CommandIntentPlannerService = require('../CommandIntentPlannerService');
const ExecutiveResponseService = require('../ExecutiveResponseService');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.MILES_COMMAND_PORT || 8787);

const stateDir = path.join(ROOT, 'state');
const logsDir = path.join(ROOT, 'logs');
const queueFile = path.join(stateDir, 'business_operations_queue.json');
const logFile = path.join(logsDir, 'miles_command_center.log');

fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

function now() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function log(level, message, metadata = {}) {
  fs.appendFileSync(
    logFile,
    JSON.stringify({
      timestamp: now(),
      level,
      service: 'MILES_COMMAND_CENTER',
      message,
      metadata
    }) + '\n'
  );
}

function classifyWorker(text, plan = {}) {
  const provider = String(plan.provider || '').toUpperCase();
  const action = String(plan.action || '').toUpperCase();
  const t = String(text || '').toLowerCase();

  if (provider === 'INSTANTLY') return 'revenueWorker';
  if (provider === 'ORION') return 'atlasWorker';
  if (provider === 'GOOGLE') return 'cooWorker';
  if (provider === 'WEBSITE') return 'cooWorker';
  if (provider === 'LINKEDIN') return 'cooWorker';

  if (action.startsWith('INSTANTLY_')) return 'revenueWorker';
  if (action.startsWith('ORION_')) return 'atlasWorker';
  if (action.startsWith('GOOGLE_')) return 'cooWorker';
  if (action.startsWith('WEBSITE_')) return 'cooWorker';
  if (action.startsWith('LINKEDIN_')) return 'cooWorker';

  if (t.includes('instantly') || t.includes('campaign') || t.includes('email') || t.includes('lead')) return 'revenueWorker';
  if (t.includes('reply') || t.includes('respond') || t.includes('inbox')) return 'replyWorker';
  if (t.includes('deal') || t.includes('proposal') || t.includes('close')) return 'dealWorker';
  if (t.includes('orion') || t.includes('opportunit') || t.includes('sled') || t.includes('contract')) return 'atlasWorker';
  if (t.includes('website') || t.includes('linkedin') || t.includes('marketing')) return 'cooWorker';
  if (t.includes('run') || t.includes('start') || t.includes('check') || t.includes('status')) return 'dispatcherWorker';

  return 'cooWorker';
}

function needsApproval(text) {
  const t = String(text || '').toLowerCase();

  return [
    'change pricing',
    'send proposal',
    'submit proposal',
    'final proposal',
    'launch campaign',
    'start campaign',
    'activate campaign',
    'send email',
    'send emails',
    'sign agreement',
    'sign contract',
    'execute contract',
    'submit bid',
    'purchase',
    'buy software',
    'pay for',
    'hire',
    'fire',
    'delete',
    'legal commitment',
    'financial commitment'
  ].some((term) => t.includes(term));
}

function normalizeProvider(provider) {
  const value = String(provider || 'MILES').trim();

  if (value.toLowerCase() === 'website') return 'Website';
  if (value.toLowerCase() === 'linkedin') return 'LinkedIn';

  return value.toUpperCase();
}


function countPendingApprovals() {
  const queue = readJson(queueFile, { operations: [] });
  const operations = Array.isArray(queue.operations) ? queue.operations : [];

  return operations.filter((operation) => {
    const status = String(operation && operation.status || '').toUpperCase();
    return status === 'WAITING_FOR_CEO_APPROVAL' || status === 'AWAITING_APPROVAL';
  }).length;
}

function classifyInteraction(command, plan = {}) {
  const text = String(command || '').trim();
  const lower = text.toLowerCase();
  const plannedIntent = String(plan.intent || '').trim().toUpperCase();

  if (
    plannedIntent === 'QUESTION' ||
    plannedIntent === 'CONVERSATION' ||
    plannedIntent === 'CHAT'
  ) {
    return plannedIntent === 'CHAT' ? 'CONVERSATION' : plannedIntent;
  }

  if (
    /^(what|why|how|who|when|where|which|can|could|would|should|are|is|do|does|did|tell me|explain)\b/i.test(text) ||
    text.endsWith('?')
  ) {
    return 'QUESTION';
  }

  if (
    /^(hello|hi|hey|good morning|good afternoon|good evening|thanks|thank you)\b/i.test(text) ||
    lower.includes("i'm worried") ||
    lower.includes('i am worried') ||
    lower.includes('i feel ')
  ) {
    return 'CONVERSATION';
  }

  return 'COMMAND';
}

async function answerConversationally(command, plan = {}) {
  const context = {
    command,
    plan,
    pendingApprovals: countPendingApprovals(),
    generatedAt: now()
  };

  const candidateMethods = [
    'answer',
    'respond',
    'converse',
    'handleConversation',
    'generateResponse'
  ];

  for (const method of candidateMethods) {
    if (executiveResponses && typeof executiveResponses[method] === 'function') {
      try {
        const result = await executiveResponses[method](command, context);

        if (typeof result === 'string' && result.trim()) {
          return result.trim();
        }

        if (result && typeof result.message === 'string' && result.message.trim()) {
          return result.message.trim();
        }

        if (result && typeof result.response === 'string' && result.response.trim()) {
          return result.response.trim();
        }
      } catch (error) {
        log('WARN', 'Executive conversation service fallback used', {
          method,
          error: error.message
        });
      }
    }
  }

  const lower = String(command || '').toLowerCase();

  if (lower.includes('what can you do') || lower.includes('what are you able to do')) {
    return [
      'I can review and manage Instantly campaigns, monitor campaign health, review opportunities, support GO/NO-GO decisions, coordinate proposal work, monitor ORION, and provide executive status summaries.',
      '',
      'I can execute routine work directly. Actions with external, financial, legal, submission, deletion, or campaign-launch impact are placed in your approval queue.',
      '',
      `You currently have ${context.pendingApprovals} item(s) waiting for approval.`
    ].join('\\n');
  }

  if (lower.includes('approval')) {
    return `You currently have ${context.pendingApprovals} item(s) waiting for approval. Open the Approval Center below to approve or deny them.`;
  }

  return [
    'I understand.',
    '',
    'I can answer executive questions directly and execute operational commands through the appropriate workflow. Protected actions will appear in your Approval Center before execution.',
    '',
    'For a current business answer, ask me about campaigns, opportunities, proposals, ORION, priorities, risks, or approvals.'
  ].join('\\n');
}

function getApprovalItems() {
  const queue = readJson(queueFile, { operations: [] });
  const operations = Array.isArray(queue.operations) ? queue.operations : [];

  return operations
    .filter((operation) => {
      const status = String(operation && operation.status || '').toUpperCase();
      return status === 'WAITING_FOR_CEO_APPROVAL' || status === 'AWAITING_APPROVAL';
    })
    .map((operation) => ({
      id: operation.id,
      title: operation.title || operation.command || operation.action,
      command: operation.command,
      provider: operation.provider,
      action: operation.action,
      worker: operation.worker,
      status: operation.status,
      createdAt: operation.createdAt
    }));
}

async function decideApproval(id, decision, modifiedCommand = '') {
  const queue = readJson(queueFile, {
    generatedAt: now(),
    source: 'MILES_COMMAND_CENTER',
    operations: []
  });

  queue.operations = Array.isArray(queue.operations) ? queue.operations : [];

  const index = queue.operations.findIndex((operation) => operation && operation.id === id);

  if (index < 0) {
    return {
      ok: false,
      status: 'APPROVAL_NOT_FOUND',
      message: 'The approval item could not be found.'
    };
  }

  const operation = queue.operations[index];
  const normalizedDecision = String(decision || '').trim().toUpperCase();

  if (normalizedDecision === 'APPROVE') {
    operation.status = 'READY';
    operation.type = operation.action || 'MILES_EXECUTE';
    operation.approvalRequired = false;
    operation.ceoEscalationOnly = false;
    operation.approvalDecision = 'APPROVED';
    operation.approvedAt = now();
    operation.updatedAt = now();
    queue.operations[index] = operation;
    queue.generatedAt = now();
    writeJson(queueFile, queue);

    let enqueueResult = null;
    if (host && typeof host.enqueueOperation === 'function') {
      enqueueResult = await host.enqueueOperation(operation);
    }

    log('INFO', 'CEO approved operation', {
      operationId: operation.id,
      action: operation.action
    });

    return {
      ok: true,
      status: 'APPROVED',
      message: 'Approved. Miles has released the task for execution.',
      operation,
      enqueueResult
    };
  }

  if (normalizedDecision === 'DENY') {
    operation.status = 'DENIED';
    operation.approvalDecision = 'DENIED';
    operation.deniedAt = now();
    operation.updatedAt = now();
    queue.operations[index] = operation;
    queue.generatedAt = now();
    writeJson(queueFile, queue);

    log('INFO', 'CEO denied operation', {
      operationId: operation.id,
      action: operation.action
    });

    return {
      ok: true,
      status: 'DENIED',
      message: 'Denied. Miles will not execute this task.',
      operation
    };
  }

  if (normalizedDecision === 'MODIFY') {
    const cleanCommand = String(modifiedCommand || '').trim();

    if (!cleanCommand) {
      return {
        ok: false,
        status: 'MODIFICATION_REQUIRED',
        message: 'Enter the revised instruction before selecting Modify.'
      };
    }

    const plan = CommandIntentPlannerService.plan({ command: cleanCommand });
    const replacement = makeOperation(cleanCommand, plan);

    operation.command = cleanCommand;
    operation.title = cleanCommand.slice(0, 120);
    operation.provider = replacement.provider;
    operation.system = replacement.system;
    operation.connector = replacement.connector;
    operation.department = replacement.department;
    operation.worker = replacement.worker;
    operation.area = replacement.area;
    operation.action = replacement.action;
    operation.intent = replacement.intent;
    operation.objective = replacement.objective;
    operation.plan = replacement.plan;
    operation.status = 'WAITING_FOR_CEO_APPROVAL';
    operation.type = 'CEO_APPROVAL_OPERATION';
    operation.approvalRequired = true;
    operation.ceoEscalationOnly = true;
    operation.approvalDecision = 'MODIFIED_PENDING_APPROVAL';
    operation.updatedAt = now();
    queue.operations[index] = operation;
    queue.generatedAt = now();
    writeJson(queueFile, queue);

    log('INFO', 'CEO modified approval item', {
      operationId: operation.id,
      action: operation.action
    });

    return {
      ok: true,
      status: 'MODIFIED',
      message: 'The approval item was updated and remains pending your approval.',
      operation
    };
  }

  return {
    ok: false,
    status: 'INVALID_APPROVAL_DECISION',
    message: 'Decision must be APPROVE, DENY, or MODIFY.'
  };
}

function makeOperation(command, plan = {}) {
  const normalizedPlan = plan && plan.ok
    ? plan
    : CommandIntentPlannerService.plan({ command });

  const provider = normalizeProvider(normalizedPlan.provider || 'MILES');
  const action = normalizedPlan.action || 'MILES_EXECUTE';

  const worker = classifyWorker(command, {
    ...normalizedPlan,
    provider,
    action
  });

  const approvalRequired = needsApproval(command);

  return {
    id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: 'MILES_COMMAND_CENTER',
    type: approvalRequired ? 'CEO_APPROVAL_OPERATION' : action,
    status: approvalRequired ? 'WAITING_FOR_CEO_APPROVAL' : 'READY',
    priority: 1,
    worker,
    area: worker.replace('Worker', ''),
    provider,
    system: normalizedPlan.system || provider,
    connector: normalizedPlan.connector || provider,
    department: normalizedPlan.department || provider,
    title: String(command || '').slice(0, 120),
    command,
    action,
    intent: normalizedPlan.intent,
    objective: normalizedPlan.objective || command,
    plan: {
      ...normalizedPlan,
      provider,
      system: normalizedPlan.system || provider,
      connector: normalizedPlan.connector || provider,
      department: normalizedPlan.department || provider,
      action
    },
    approvalRequired,
    ceoEscalationOnly: approvalRequired,
    createdAt: now(),
    updatedAt: now(),
    result: null
  };
}

function addToQueue(operation) {
  const queue = readJson(queueFile, {
    generatedAt: now(),
    source: 'MILES_COMMAND_CENTER',
    operations: []
  });

  queue.operations = Array.isArray(queue.operations) ? queue.operations : [];
  queue.operations.unshift(operation);
  queue.generatedAt = now();

  writeJson(queueFile, queue);
}

const host = new DigitalCOOHost({ rootDir: ROOT });
const executiveResponses = new ExecutiveResponseService({ rootDir: ROOT });

async function handleCommand(command) {
  const cleanCommand = String(command || '').trim();

  if (!cleanCommand) {
    return {
      ok: false,
      status: 'EMPTY_COMMAND',
      message: 'No command was provided.'
    };
  }

  const plan = CommandIntentPlannerService.plan({
    command: cleanCommand
  });

  const interactionType = classifyInteraction(cleanCommand, plan);

  if (interactionType === 'QUESTION' || interactionType === 'CONVERSATION') {
    const response = await answerConversationally(cleanCommand, plan);

    log('INFO', 'Executive conversation answered', {
      interactionType,
      plannedIntent: plan && plan.intent
    });

    return {
      ok: true,
      status: 'ANSWERED',
      mode: 'CONVERSATION',
      interactionType,
      response,
      pendingApprovals: countPendingApprovals()
    };
  }

  const operation = makeOperation(cleanCommand, plan);

  addToQueue(operation);

  let enqueueResult = null;

  if (!operation.approvalRequired && host && typeof host.enqueueOperation === 'function') {
    enqueueResult = await host.enqueueOperation(operation);
  }

  log('INFO', `Command accepted: ${cleanCommand}`, {
    operationId: operation.id,
    provider: operation.provider,
    action: operation.action,
    worker: operation.worker,
    approvalRequired: operation.approvalRequired
  });

  return {
    ok: true,
    status: operation.approvalRequired
      ? 'WAITING_FOR_CEO_APPROVAL'
      : 'COMMAND_ACCEPTED',
    mode: operation.approvalRequired
      ? 'APPROVAL'
      : 'EXECUTION',
    message: operation.approvalRequired
      ? 'This action requires your approval before Miles can execute it.'
      : 'Miles accepted the work and added it to the operations queue.',
    operation,
    enqueueResult
  };
}

function page() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Miles Command Center</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background:#0f172a;
      color:#e5e7eb;
      margin:0;
    }
    .wrap {
      max-width: 960px;
      margin: 40px auto;
      padding: 24px;
    }
    h1 {
      margin-bottom: 4px;
    }
    .sub {
      color:#94a3b8;
      margin-bottom:24px;
    }
    textarea {
      width:100%;
      height:120px;
      font-size:18px;
      padding:14px;
      border-radius:10px;
      border:0;
      box-sizing:border-box;
    }
    button {
      margin-top:12px;
      padding:12px 20px;
      font-size:16px;
      border:0;
      border-radius:10px;
      cursor:pointer;
      background:#22c55e;
      color:#052e16;
      font-weight:bold;
    }
    .card {
      background:#111827;
      padding:18px;
      border-radius:12px;
      margin-top:20px;
      white-space:pre-wrap;
      overflow:auto;
    }
    .ok {
      color:#86efac;
      font-weight:bold;
    }
    .warn {
      color:#fde68a;
      font-weight:bold;
    }
    .bad {
      color:#fca5a5;
      font-weight:bold;
    }
    .muted {
      color:#94a3b8;
    }
    .grid {
      display:grid;
      grid-template-columns: repeat(4, 1fr);
      gap:12px;
      margin-top:16px;
    }
    .mini {
      background:#020617;
      border:1px solid #1e293b;
      border-radius:10px;
      padding:12px;
    }
    .mini .label {
      color:#94a3b8;
      font-size:12px;
      margin-bottom:6px;
    }
    .mini .value {
      font-size:16px;
      font-weight:bold;
      word-break:break-word;
    }
    pre {
      background:#020617;
      border:1px solid #1e293b;
      border-radius:10px;
      padding:14px;
      overflow:auto;
    }

    .toolbar {
      display:flex;
      gap:12px;
      align-items:center;
      margin-top:12px;
      flex-wrap:wrap;
    }
    .secondary {
      background:#334155;
      color:#e2e8f0;
    }
    .danger {
      background:#ef4444;
      color:#fff;
    }
    .approval {
      border:1px solid #f59e0b;
      background:#1c1917;
    }
    .approval-actions {
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      margin-top:12px;
    }
    .approval-actions button {
      margin-top:0;
    }
    .modify-input {
      width:100%;
      margin-top:10px;
      padding:10px;
      box-sizing:border-box;
      border-radius:8px;
      border:1px solid #475569;
      background:#020617;
      color:#e5e7eb;
    }
    details {
      margin-top:14px;
      color:#94a3b8;
    }

  </style>
</head>
<body>
  <div class="wrap">
    <h1>Miles Command Center</h1>
    <div class="sub">Talk to Miles like your Digital COO. Questions receive direct answers. Commands are executed. Protected actions wait for your approval.</div>

    <textarea id="cmd" placeholder="Ask a question or give Miles a business instruction."></textarea>
    <div class="toolbar">
      <button onclick="send()">Send to Miles</button>
      <button class="secondary" onclick="loadApprovals()">Approvals <span id="approvalCount"></span></button>
    </div>

    <div id="out" class="card">Miles is ready.</div>
    <div id="approvals"></div>
  </div>

<script>
let currentOperationId = null;
let pollTimer = null;

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function statusClass(status) {
  const s = String(status || '').toUpperCase();

  if (s === 'COMPLETED' || s === 'COMMAND_ACCEPTED' || s === 'READY') return 'ok';
  if (s === 'FAILED' || s === 'ERROR') return 'bad';
  return 'warn';
}

function renderConversation(data) {
  document.getElementById('out').innerHTML =
    '<span class="ok">MILES</span>\\n\\n' +
    esc(data.response || data.message || 'I am ready.') +
    (data.pendingApprovals !== undefined
      ? '\\n\\n<span class="muted">Pending approvals: ' + esc(data.pendingApprovals) + '</span>'
      : '');
}

function approvalCard(operation) {
  const op = operation || {};

  return '<div class="card approval">' +
    '<span class="warn">CEO APPROVAL REQUIRED</span>\\n\\n' +
    '<strong>' + esc(op.title || op.command || op.action || 'Protected action') + '</strong>\\n\\n' +
    '<span class="muted">Action: ' + esc(op.action || '') + ' | Provider: ' + esc(op.provider || '') + '</span>' +
    '<input class="modify-input" id="modify-' + esc(op.id || '') + '" value="' + esc(op.command || '') + '" />' +
    '<div class="approval-actions">' +
      '<button onclick="decideApproval(\\'' + esc(op.id || '') + '\\', \\'APPROVE\\')">Approve</button>' +
      '<button class="danger" onclick="decideApproval(\\'' + esc(op.id || '') + '\\', \\'DENY\\')">Deny</button>' +
      '<button class="secondary" onclick="decideApproval(\\'' + esc(op.id || '') + '\\', \\'MODIFY\\')">Modify</button>' +
    '</div>' +
    '<details><summary>Technical details</summary><pre>' + esc(JSON.stringify(op, null, 2)) + '</pre></details>' +
  '</div>';
}

function renderAccepted(data) {
  if (data.mode === 'CONVERSATION' || data.status === 'ANSWERED') {
    renderConversation(data);
    return;
  }

  const op = data.operation || {};

  if (data.mode === 'APPROVAL' || String(data.status || '').toUpperCase().includes('APPROVAL')) {
    document.getElementById('out').innerHTML =
      esc(data.message || 'This action requires approval.') +
      approvalCard(op);
    loadApprovals();
    return;
  }

  document.getElementById('out').innerHTML =
    '<span class="' + statusClass(data.status) + '">' + esc(data.status) + '</span>\\n\\n' +
    esc(data.message || 'Miles is working on this.') +
    '\\n\\n<span class="muted">Operation: ' + esc(op.id || '') + '</span>' +
    '<details><summary>Technical details</summary><pre>' + esc(JSON.stringify(op, null, 2)) + '</pre></details>';
}

function renderResponse(data) {
  const latest = data.latestTask || {};
  const status = data.status || 'UNKNOWN';
  const normalized = String(status).toUpperCase();

  if (normalized === 'AWAITING_APPROVAL' || normalized === 'WAITING_FOR_CEO_APPROVAL') {
    document.getElementById('out').innerHTML =
      esc(data.message || 'This action requires approval.') +
      approvalCard(data.operation || latest || { id: data.operationId });
    loadApprovals();
    return;
  }

  const result = data.result && data.result.result
    ? data.result.result
    : data.result;

  let executiveMessage = data.message || '';

  if (normalized === 'COMPLETED') {
    executiveMessage = executiveMessage || 'Miles completed the task.';
  } else if (normalized === 'FAILED') {
    executiveMessage = executiveMessage || 'Miles could not complete the task.';
  } else {
    executiveMessage = executiveMessage || 'Miles is working on the task.';
  }

  document.getElementById('out').innerHTML =
    '<span class="' + statusClass(status) + '">' + esc(status) + '</span>\\n\\n' +
    esc(executiveMessage) +
    (result && result.summary ? '\\n\\n' + esc(result.summary) : '') +
    '<details><summary>Technical details</summary><pre>' + esc(JSON.stringify(data, null, 2)) + '</pre></details>';
}

async function loadApprovals() {
  try {
    const res = await fetch('/api/approvals');
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    const count = document.getElementById('approvalCount');
    const target = document.getElementById('approvals');

    if (count) {
      count.textContent = items.length ? '(' + items.length + ')' : '';
    }

    if (!target) return;

    target.innerHTML = items.length
      ? '<div class="card"><span class="warn">PENDING APPROVALS (' + items.length + ')</span></div>' +
        items.map(approvalCard).join('')
      : '<div class="card"><span class="ok">No approvals are waiting.</span></div>';
  } catch (error) {
    document.getElementById('approvals').innerHTML =
      '<div class="card"><span class="bad">Could not load approvals.</span> ' + esc(error.message) + '</div>';
  }
}

async function decideApproval(id, decision) {
  const input = document.getElementById('modify-' + id);
  const modifiedCommand = input ? input.value.trim() : '';

  const res = await fetch('/api/approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      decision,
      modifiedCommand
    })
  });

  const data = await res.json();

  if (!data.ok) {
    document.getElementById('out').innerHTML =
      '<span class="bad">' + esc(data.status || 'ERROR') + '</span>\\n\\n' +
      esc(data.message || data.error || 'Approval action failed.');
    return;
  }

  document.getElementById('out').innerHTML =
    '<span class="' + statusClass(data.status) + '">' + esc(data.status) + '</span>\\n\\n' +
    esc(data.message || '');

  loadApprovals();

  if (data.status === 'APPROVED' && data.operation && data.operation.id) {
    currentOperationId = data.operation.id;
    startPolling(currentOperationId);
  }
}

async function send() {
  const command = document.getElementById('cmd').value.trim();
  if (!command) return;

  document.getElementById('out').textContent = 'Sending to Miles...';

  const res = await fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command })
  });

  const data = await res.json();

  if (!data.ok) {
    document.getElementById('out').innerHTML =
      '<span class="bad">' + esc(data.status || 'ERROR') + '</span>\\n\\n' +
      esc(data.message || data.error || 'Unknown error');
    return;
  }

  renderAccepted(data);

  if (data.mode === 'CONVERSATION' || data.status === 'ANSWERED') {
    currentOperationId = null;
    return;
  }

  currentOperationId = data.operation && data.operation.id;

  if (
    currentOperationId &&
    data.mode !== 'APPROVAL' &&
    String(data.status || '').toUpperCase() !== 'WAITING_FOR_CEO_APPROVAL'
  ) {
    startPolling(currentOperationId);
  }
}

function startPolling(operationId) {
  if (pollTimer) clearInterval(pollTimer);

  pollOperation(operationId);

  pollTimer = setInterval(function() {
    pollOperation(operationId);
  }, 3000);
}

async function pollOperation(operationId) {
  try {
    const res = await fetch('/api/operation?id=' + encodeURIComponent(operationId));
    const data = await res.json();

    renderResponse(data);

    const s = String(data.status || '').toUpperCase();

    if (
      s === 'COMPLETED' ||
      s === 'FAILED' ||
      s === 'AWAITING_APPROVAL' ||
      s === 'WAITING_FOR_CEO_APPROVAL'
    ) {
      if (pollTimer) clearInterval(pollTimer);
    }
  } catch (error) {
    document.getElementById('out').innerHTML =
      '<span class="bad">POLLING_ERROR</span>\\n\\n' +
      esc(error.message);
  }
}

window.addEventListener('load', loadApprovals);
</script>
</body>
</html>`;
}

async function start() {
  await host.start();

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page());
      return;
    }

    if (req.method === 'GET' && req.url === '/api/approvals') {
      const items = getApprovalItems();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        status: 'APPROVALS_READY',
        count: items.length,
        items
      }, null, 2));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/approval') {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = await decideApproval(
            String(payload.id || '').trim(),
            String(payload.decision || '').trim(),
            String(payload.modifiedCommand || '').trim()
          );

          res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result, null, 2));
        } catch (error) {
          log('ERROR', 'Approval handling failed', {
            error: error.message
          });

          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error.message }, null, 2));
        }
      });

      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/operation')) {
      try {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        const id = url.searchParams.get('id');

        const result = executiveResponses.getResponse(id);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
      } catch (error) {
        log('ERROR', 'Operation response failed', {
          error: error.message
        });

        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error.message }, null, 2));
      }

      return;
    }

    if (req.method === 'POST' && req.url === '/api/command') {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = await handleCommand(String(payload.command || '').trim());

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result, null, 2));
        } catch (error) {
          log('ERROR', 'Command handling failed', {
            error: error.message
          });

          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error.message }, null, 2));
        }
      });

      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, () => {
    console.log(`Miles Command Center running: http://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop.');
  });

  process.on('SIGINT', async () => {
    console.log('\\nStopping Miles...');
    await host.stop();
    process.exit(0);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
