'use strict';

const tls = require('tls');
require('dotenv').config();

const HOST = process.env.IONOS_SMTP_HOST || 'smtp.ionos.com';
const PORT = Number(process.env.IONOS_SMTP_PORT || 465);
const TIMEOUT_MS = Number(process.env.IONOS_SMTP_TIMEOUT_MS || 20000);
const KEVIN_EMAIL = String(process.env.IONOS_KEVIN_EMAIL || 'kevin@pathways2gc.com').trim().toLowerCase();

function kevinMailbox() {
  return {
    email: KEVIN_EMAIL,
    password: process.env.IONOS_KEVIN_PASSWORD || ''
  };
}

function b64(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function dotStuff(text) {
  return String(text || '').replace(/(^|\r?\n)\./g, '$1..');
}

function normalizeRecipients(value) {
  const arr = Array.isArray(value) ? value : String(value || '').split(',');
  return arr.map(v => String(v || '').trim()).filter(Boolean);
}

function encodeHeader(value) {
  const text = String(value == null ? '' : value);
  return /[^\x20-\x7E]/.test(text)
    ? `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`
    : text;
}

function buildMessage({ from, to, replyTo, subject, text }) {
  const recipients = normalizeRecipients(to);
  const headers = [
    `From: ${from}`,
    `To: ${recipients.join(', ')}`,
    `Reply-To: ${replyTo || from}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit'
  ];
  return `${headers.join('\r\n')}\r\n\r\n${String(text || '').replace(/\r?\n/g, '\r\n')}`;
}

function parseCode(line) {
  const m = String(line || '').match(/^(\d{3})[ -]/);
  return m ? Number(m[1]) : null;
}

function sendEmail(options = {}) {
  return new Promise((resolve, reject) => {
    const account = kevinMailbox();
    const from = String(options.from || account.email).trim().toLowerCase();
    const recipients = normalizeRecipients(options.to);
    const subject = String(options.subject || '').trim();
    const text = String(options.text || '');

    if (from !== account.email) return reject(new Error('IONOS_SENDER_NOT_AUTHORIZED'));
    if (!account.password) return reject(new Error('IONOS_KEVIN_PASSWORD_NOT_CONFIGURED'));
    if (!recipients.length) return reject(new Error('IONOS_SMTP_RECIPIENT_REQUIRED'));
    if (!subject) return reject(new Error('IONOS_SMTP_SUBJECT_REQUIRED'));

    const socket = tls.connect({ host: HOST, port: PORT, servername: HOST, rejectUnauthorized: true });
    socket.setTimeout(TIMEOUT_MS);

    let buffer = '';
    const queue = [];
    let closed = false;

    function finish(error, result) {
      if (closed) return;
      closed = true;
      try { socket.end(); } catch (_) {}
      if (error) reject(error); else resolve(result);
    }

    function readResponse() {
      return new Promise((res, rej) => queue.push({ res, rej, lines: [] }));
    }

    function processLines() {
      const parts = buffer.split(/\r\n/);
      buffer = parts.pop() || '';
      for (const line of parts) {
        if (!line) continue;
        const current = queue[0];
        if (!current) continue;
        current.lines.push(line);
        const code = parseCode(line);
        if (code && /^\d{3} /.test(line)) {
          queue.shift();
          if (code >= 200 && code < 400) current.res({ code, lines: current.lines.slice() });
          else current.rej(new Error(`IONOS_SMTP_${code}: ${current.lines.join(' | ')}`));
        }
      }
    }

    async function command(value) {
      const p = readResponse();
      socket.write(`${value}\r\n`);
      return p;
    }

    socket.on('data', chunk => { buffer += chunk.toString('utf8'); processLines(); });
    socket.on('timeout', () => finish(new Error('IONOS_SMTP_TIMEOUT')));
    socket.on('error', error => finish(error));

    socket.on('secureConnect', async () => {
      try {
        await readResponse(); // server greeting
        await command(`EHLO ${process.env.IONOS_SMTP_EHLO || 'pathways2gc.com'}`);
        await command('AUTH LOGIN');
        await command(b64(account.email));
        await command(b64(account.password));
        await command(`MAIL FROM:<${account.email}>`);
        for (const recipient of recipients) await command(`RCPT TO:<${recipient}>`);
        await command('DATA');
        const message = dotStuff(buildMessage({ from: account.email, to: recipients, replyTo: options.replyTo || account.email, subject, text }));
        const dataResponse = readResponse();
        socket.write(`${message}\r\n.\r\n`);
        const accepted = await dataResponse;
        try { await command('QUIT'); } catch (_) {}
        finish(null, {
          ok: true,
          status: 'IONOS_SMTP_SENT',
          account: account.email,
          to: recipients,
          subject,
          smtpHost: HOST,
          smtpPort: PORT,
          acceptedCode: accepted.code,
          sentAt: new Date().toISOString()
        });
      } catch (error) {
        finish(error);
      }
    });
  });
}

async function healthCheck() {
  const account = kevinMailbox();
  return {
    ok: Boolean(account.email && account.password),
    status: account.password ? 'IONOS_KEVIN_SMTP_CONFIG_READY' : 'IONOS_KEVIN_SMTP_CREDENTIAL_MISSING',
    account: account.email,
    smtpHost: HOST,
    smtpPort: PORT,
    sendPerformed: false,
    checkedAt: new Date().toISOString()
  };
}

module.exports = { HOST, PORT, KEVIN_EMAIL, kevinMailbox, buildMessage, sendEmail, healthCheck };
