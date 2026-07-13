// EXEC_009_NAMECHEAP — MILES OS provider module
// Controlled-write compatible. Secrets must come from environment/vault.

import { DNSRecord, CheckResult } from './MODELS';

export function verifyDKIM(records: DNSRecord[], selector = 'google'): CheckResult {
  const host = `${selector}._domainkey`;
  const dkim = records.find(r => r.type === 'TXT' && r.host.toLowerCase() === host.toLowerCase());
  if (dkim) return { status: 'PASS', message: `DKIM record found for selector ${selector}.`, evidence: dkim };
  return { status: 'WARN', message: `No DKIM record found for selector ${selector}.` };
}
