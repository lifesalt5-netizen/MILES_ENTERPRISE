'use strict';

const tls = require('tls');
require('dotenv').config();
const readonly = require('./imap_readonly');

const HOST = readonly.HOST;
const PORT = readonly.PORT;
const TIMEOUT_MS = Number(process.env.IONOS_IMAP_TIMEOUT_MS || 20000);

function clean(v) { return String(v || '').trim(); }
function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1','true','yes','y','on'].includes(String(raw).trim().toLowerCase());
}
function quote(value) { return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }
function mutationAllowed() {
  return envBool('MILES_DRY_RUN', true) === false &&
    envBool('MILES_CONTROLLED_WRITE_ENABLED', false) === true &&
    envBool('MILES_IONOS_MAILBOX_MUTATIONS', false) === true;
}

// Continuous IONOS hygiene runs in the same process as other revenue sidecars.
// Opening the global MILES write gates there would broaden authority to unrelated
// systems. This narrowly-scoped capability authorizes only the non-destructive
// IONOS folder CREATE + UID MOVE operations implemented below.
function hygieneMutationAllowed() {
  return envBool('MILES_REHEARSAL_MODE', false) === false &&
    envBool('MILES_AUTONOMOUS_EXECUTE', true) === true &&
    envBool('MILES_IONOS_HYGIENE_ENABLED', true) === true &&
    envBool('MILES_IONOS_HYGIENE_EXECUTE', true) === true;
}

function connectAndRun({ email, password, commands = [], selectMailbox = null, readOnly = true }) {
  return new Promise((resolve, reject) => {
    if (!email || !password) return reject(new Error(`Missing IONOS credentials for ${email || 'unknown mailbox'}`));
    const socket = tls.connect({ host: HOST, port: PORT, servername: HOST, rejectUnauthorized: true });
    socket.setTimeout(TIMEOUT_MS);
    let buffer = '';
    let seq = 0;
    const pending = [];
    let completed = false;

    function finish(error, result) {
      if (completed) return;
      completed = true;
      try { socket.end(); } catch {}
      if (error) reject(error); else resolve(result);
    }
    function send(command) {
      return new Promise((res, rej) => {
        const tag = `G${String(++seq).padStart(4, '0')}`;
        pending.push({ tag, res, rej, lines: [] });
        socket.write(`${tag} ${command}\r\n`);
      });
    }
    function processLines() {
      const parts = buffer.split(/\r\n/);
      buffer = parts.pop() || '';
      for (const line of parts) {
        if (!line) continue;
        const current = pending[0];
        if (current) current.lines.push(line);
        if (current && line.startsWith(`${current.tag} `)) {
          pending.shift();
          if (/^G\d+ OK\b/i.test(line)) current.res(current.lines.slice());
          else current.rej(new Error(`IMAP command failed for ${email}: ${line}`));
        }
      }
    }

    socket.on('data', chunk => { buffer += chunk.toString('utf8'); processLines(); });
    socket.on('timeout', () => finish(new Error(`IONOS IMAP timeout for ${email}`)));
    socket.on('error', error => finish(error));
    socket.on('secureConnect', async () => {
      try {
        await send(`LOGIN ${quote(email)} ${quote(password)}`);
        const selection = selectMailbox
          ? await send(`${readOnly ? 'EXAMINE' : 'SELECT'} ${quote(selectMailbox)}`)
          : [];
        const extra = [];
        for (const command of commands) extra.push({ command, lines: await send(command) });
        try { await send('LOGOUT'); } catch {}
        finish(null, { ok: true, email, selection, extra });
      } catch (error) { finish(error); }
    });
  });
}

function parseList(lines = []) {
  const names = [];
  for (const line of lines) {
    const match = line.match(/^\* LIST \([^)]*\) "[^"]*" "([^"]+)"/i) || line.match(/^\* LIST .*? (?:"([^"]+)"|([^\s]+))$/i);
    const name = clean(match?.[1] || match?.[2]);
    if (name) names.push(name);
  }
  return [...new Set(names)];
}

async function listMailboxes(mailbox) {
  const result = await connectAndRun({ ...mailbox, commands: ['LIST "" "*"'] });
  return parseList(result.extra?.[0]?.lines || []);
}

async function ensureMailbox(mailbox, folder) {
  const names = await listMailboxes(mailbox);
  const existing = names.find(name => name.toLowerCase() === folder.toLowerCase());
  if (existing) return { ok: true, folder: existing, created: false };
  if (!mutationAllowed()) return { ok: false, status: 'IONOS_MUTATION_GATES_CLOSED', folder, mutationExecuted: false };
  await connectAndRun({ ...mailbox, commands: [`CREATE ${quote(folder)}`] });
  return { ok: true, folder, created: true };
}

async function ensureMailboxForHygiene(mailbox, folder) {
  const names = await listMailboxes(mailbox);
  const existing = names.find(name => name.toLowerCase() === folder.toLowerCase());
  if (existing) return { ok: true, folder: existing, created: false };
  if (!hygieneMutationAllowed()) return { ok: false, status: 'IONOS_HYGIENE_MUTATION_SCOPE_CLOSED', folder, mutationExecuted: false };
  await connectAndRun({ ...mailbox, commands: [`CREATE ${quote(folder)}`] });
  return { ok: true, folder, created: true };
}

async function moveUids(mailbox, uids = [], folder, sourceMailbox = 'INBOX') {
  const ids = [...new Set((uids || []).map(Number).filter(Number.isFinite))];
  if (!ids.length) return { ok: true, mutationExecuted: false, moved: 0, folder, sourceMailbox };
  if (!mutationAllowed()) return { ok: false, status: 'IONOS_MUTATION_GATES_CLOSED', mutationExecuted: false, moved: 0, folder, sourceMailbox };
  const ensured = await ensureMailbox(mailbox, folder);
  if (!ensured.ok) return ensured;
  const result = await connectAndRun({
    ...mailbox,
    selectMailbox: sourceMailbox,
    readOnly: false,
    commands: [`UID MOVE ${ids.join(',')} ${quote(ensured.folder)}`]
  });
  return {
    ok: result.ok === true,
    mutationExecuted: result.ok === true,
    moved: result.ok === true ? ids.length : 0,
    sourceMailbox,
    folder: ensured.folder,
    operation: 'UID_MOVE',
    authorizationScope: 'GLOBAL_CONTROLLED_WRITE',
    destructiveDeleteUsed: false
  };
}

async function moveUidsForHygiene(mailbox, uids = [], folder, sourceMailbox = 'INBOX') {
  const ids = [...new Set((uids || []).map(Number).filter(Number.isFinite))];
  if (!ids.length) return { ok: true, mutationExecuted: false, moved: 0, folder, sourceMailbox, authorizationScope: 'IONOS_HYGIENE_UID_MOVE_ONLY' };
  if (!hygieneMutationAllowed()) {
    return {
      ok: false,
      status: 'IONOS_HYGIENE_MUTATION_SCOPE_CLOSED',
      mutationExecuted: false,
      moved: 0,
      folder,
      sourceMailbox,
      authorizationScope: 'IONOS_HYGIENE_UID_MOVE_ONLY'
    };
  }
  const ensured = await ensureMailboxForHygiene(mailbox, folder);
  if (!ensured.ok) return { ...ensured, authorizationScope: 'IONOS_HYGIENE_UID_MOVE_ONLY' };
  const result = await connectAndRun({
    ...mailbox,
    selectMailbox: sourceMailbox,
    readOnly: false,
    commands: [`UID MOVE ${ids.join(',')} ${quote(ensured.folder)}`]
  });
  return {
    ok: result.ok === true,
    mutationExecuted: result.ok === true,
    moved: result.ok === true ? ids.length : 0,
    sourceMailbox,
    folder: ensured.folder,
    operation: 'UID_MOVE',
    authorizationScope: 'IONOS_HYGIENE_UID_MOVE_ONLY',
    destructiveDeleteUsed: false
  };
}

module.exports = {
  mailboxConfigs: readonly.mailboxConfigs,
  listMailboxes,
  ensureMailbox,
  ensureMailboxForHygiene,
  moveUids,
  moveUidsForHygiene,
  mutationAllowed,
  hygieneMutationAllowed,
  connectAndRun
};
