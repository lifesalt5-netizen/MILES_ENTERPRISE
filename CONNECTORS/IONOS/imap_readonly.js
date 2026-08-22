'use strict';

const tls = require('tls');
require('dotenv').config();

const HOST = process.env.IONOS_IMAP_HOST || 'imap.ionos.com';
const PORT = Number(process.env.IONOS_IMAP_PORT || 993);
const TIMEOUT_MS = Number(process.env.IONOS_IMAP_TIMEOUT_MS || 15000);

function quote(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function mailboxConfigs() {
  return [
    { key: 'info', email: process.env.IONOS_INFO_EMAIL || 'info@pathways2gc.com', password: process.env.IONOS_INFO_PASSWORD || '' },
    { key: 'kevin', email: process.env.IONOS_KEVIN_EMAIL || 'kevin@pathways2gc.com', password: process.env.IONOS_KEVIN_PASSWORD || '' }
  ];
}

function connectAndRun({ email, password, commands = [] }) {
  return new Promise((resolve, reject) => {
    if (!email || !password) return reject(new Error(`Missing IONOS credentials for ${email || 'unknown mailbox'}`));

    const socket = tls.connect({ host: HOST, port: PORT, servername: HOST, rejectUnauthorized: true });
    socket.setTimeout(TIMEOUT_MS);

    let buffer = '';
    let seq = 0;
    const pending = [];
    let completed = false;

    function cleanup(error, result) {
      if (completed) return;
      completed = true;
      try { socket.end(); } catch (_) {}
      if (error) reject(error); else resolve(result);
    }

    function send(command) {
      return new Promise((res, rej) => {
        const tag = `A${String(++seq).padStart(4, '0')}`;
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
          if (/^A\d+ OK\b/i.test(line)) current.res(current.lines.slice());
          else current.rej(new Error(`IMAP command failed for ${email}: ${line}`));
        }
      }
    }

    socket.on('data', chunk => { buffer += chunk.toString('utf8'); processLines(); });
    socket.on('timeout', () => cleanup(new Error(`IONOS IMAP timeout for ${email}`)));
    socket.on('error', error => cleanup(error));

    socket.on('secureConnect', async () => {
      try {
        const loginLines = await send(`LOGIN ${quote(email)} ${quote(password)}`);
        const selectLines = await send('EXAMINE INBOX');
        const extra = [];
        for (const command of commands) extra.push({ command, lines: await send(command) });
        try { await send('LOGOUT'); } catch (_) {}
        cleanup(null, { ok: true, email, host: HOST, port: PORT, loginLines, selectLines, extra });
      } catch (error) {
        cleanup(error);
      }
    });
  });
}

async function healthCheck(mailbox) {
  const result = await connectAndRun(mailbox);
  const existsLine = (result.selectLines || []).find(line => /^\* \d+ EXISTS$/i.test(line));
  const exists = existsLine ? Number(existsLine.split(' ')[1]) : null;
  return { ok: true, email: mailbox.email, host: HOST, port: PORT, inboxExists: exists, readOnly: true };
}

async function healthCheckAll() {
  const results = [];
  for (const mailbox of mailboxConfigs()) {
    try {
      results.push(await healthCheck(mailbox));
    } catch (error) {
      results.push({ ok: false, email: mailbox.email, host: HOST, port: PORT, readOnly: true, error: error.message });
    }
  }
  return { ok: results.length > 0 && results.every(r => r.ok), mailboxes: results, readOnly: true };
}

function imapDate(date) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${date.getUTCDate()}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

function searchUids(lines = []) {
  const row = lines.find(line => /^\* SEARCH(?:\s|$)/i.test(line));
  if (!row) return [];
  return row.replace(/^\* SEARCH\s*/i, '').trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite);
}

function parseHeaderBlock(raw) {
  const normalized = String(raw || '').replace(/\r\n[ \t]+/g, ' ');
  const headers = {};
  for (const line of normalized.split(/\r\n|\n/)) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) headers[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return headers;
}

function parseFetchedMessages(lines = [], accountEmail = '') {
  const messages = [];
  let current = null;
  for (const line of lines) {
    const start = line.match(/^\* \d+ FETCH \(UID (\d+)/i);
    if (start) {
      if (current) messages.push(current);
      current = { uid: Number(start[1]), parts: [line] };
      continue;
    }
    if (current) current.parts.push(line);
  }
  if (current) messages.push(current);

  return messages.map(item => {
    const raw = item.parts.join('\r\n');
    const literalStart = raw.indexOf('\r\n');
    const payload = literalStart >= 0 ? raw.slice(literalStart + 2).replace(/\r\n\)\s*$/, '') : raw;
    const split = payload.search(/\r\n\r\n|\n\n/);
    const headerText = split >= 0 ? payload.slice(0, split) : payload;
    const bodyText = split >= 0 ? payload.slice(split).replace(/^(\r\n\r\n|\n\n)/, '') : '';
    const headers = parseHeaderBlock(headerText);
    return {
      id: `ionos:${accountEmail}:${item.uid}`,
      uid: item.uid,
      from: headers.from || '',
      to: headers.to || accountEmail,
      subject: headers.subject || '',
      timestamp: headers.date ? new Date(headers.date).toISOString() : new Date().toISOString(),
      messageId: headers['message-id'] || '',
      milesExecutiveTriage: /^(true|1|yes)$/i.test(headers['x-miles-executive-triage'] || ''),
      text: bodyText.slice(0, 12000),
      rawHeader: headerText.slice(0, 12000)
    };
  }).filter(message => Number.isFinite(message.uid));
}

async function fetchRecentMessages(mailbox, options = {}) {
  const lookbackDays = Math.min(Math.max(Number(options.lookbackDays || 7), 1), 30);
  const maxMessages = Math.min(Math.max(Number(options.maxMessages || 100), 1), 250);
  const since = new Date(Date.now() - lookbackDays * 86400000);
  const searched = await connectAndRun({ ...mailbox, commands: [`UID SEARCH SINCE ${imapDate(since)}`] });
  const uids = searchUids(searched.extra?.[0]?.lines || []).slice(-maxMessages);
  if (!uids.length) return { ok: true, email: mailbox.email, messages: [], uids: [], readOnly: true };
  const sequence = uids.join(',');
  const fetched = await connectAndRun({
    ...mailbox,
    commands: [`UID FETCH ${sequence} (UID BODY.PEEK[]<0.16384>)`]
  });
  const messages = parseFetchedMessages(fetched.extra?.[0]?.lines || [], mailbox.email);
  return { ok: true, email: mailbox.email, messages, uids, readOnly: true };
}

module.exports = {
  HOST,
  PORT,
  mailboxConfigs,
  connectAndRun,
  healthCheck,
  healthCheckAll,
  fetchRecentMessages,
  parseFetchedMessages,
  searchUids
};
