// EXEC_009_NAMECHEAP — MILES OS provider module
// Controlled-write compatible. Secrets must come from environment/vault.

import { DNSRecord, CheckResult } from './MODELS';

export function verifySPF(records: DNSRecord[]): CheckResult {
  const spf = records.filter(r => r.type === 'TXT' && r.value.toLowerCase().includes('v=spf1'));
  if (spf.length === 1) return { status: 'PASS', message: 'One SPF record found.', evidence: spf[0] };
  if (spf.length > 1) return { status: 'FAIL', message: 'Multiple SPF records found.', evidence: spf };
  return { status: 'WARN', message: 'No SPF record found.' };
}

export function planSPF(domain: string, includes: string[] = ['include:_spf.google.com']): DNSRecord {
  return { host: '@', type: 'TXT', value: `v=spf1 ${includes.join(' ')} ~all`, ttl: 1800 };
}
