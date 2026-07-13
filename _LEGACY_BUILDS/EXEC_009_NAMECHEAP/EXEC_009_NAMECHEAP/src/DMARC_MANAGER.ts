// EXEC_009_NAMECHEAP — MILES OS provider module
// Controlled-write compatible. Secrets must come from environment/vault.

import { DNSRecord, CheckResult } from './MODELS';

export function verifyDMARC(records: DNSRecord[]): CheckResult {
  const dmarc = records.find(r => r.type === 'TXT' && r.host.toLowerCase() === '_dmarc');
  if (!dmarc) return { status: 'WARN', message: 'No DMARC record found.' };
  const value = dmarc.value.toLowerCase();
  if (value.includes('p=none')) return { status: 'WARN', message: 'DMARC exists but policy is p=none.', evidence: dmarc };
  return { status: 'PASS', message: 'DMARC record found with enforcement policy.', evidence: dmarc };
}

export function planDMARC(policy: 'none'|'quarantine'|'reject' = 'quarantine'): DNSRecord {
  return { host: '_dmarc', type: 'TXT', value: `v=DMARC1; p=${policy}; rua=mailto:dmarc@%DOMAIN%; pct=100`, ttl: 1800 };
}
