// EXEC_009_NAMECHEAP — MILES OS provider module
// Controlled-write compatible. Secrets must come from environment/vault.

import { DNSRecord, CheckResult } from './MODELS';

export function verifyMX(records: DNSRecord[]): CheckResult {
  const mx = records.filter(r => r.type === 'MX');
  if (mx.length) return { status: 'PASS', message: `${mx.length} MX record(s) found.`, evidence: mx };
  return { status: 'FAIL', message: 'No MX records found.' };
}
