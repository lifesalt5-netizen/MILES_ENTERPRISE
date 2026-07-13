// EXEC_009_NAMECHEAP — MILES OS provider module
// Controlled-write compatible. Secrets must come from environment/vault.

import { DNSRecord, DomainHealth, CheckResult } from './MODELS';
import { verifySPF } from './SPF_MANAGER';
import { verifyDKIM } from './DKIM_MANAGER';
import { verifyDMARC } from './DMARC_MANAGER';
import { verifyMX } from './MX_MANAGER';

function scoreCheck(c: CheckResult): number {
  if (c.status === 'PASS') return 20;
  if (c.status === 'WARN') return 10;
  if (c.status === 'UNKNOWN') return 5;
  return 0;
}

export function calculateDomainHealth(domain: string, records: DNSRecord[], expires?: string): DomainHealth {
  const spf = verifySPF(records);
  const dkim = verifyDKIM(records);
  const dmarc = verifyDMARC(records);
  const mx = verifyMX(records);
  const dns: CheckResult = { status: 'PASS', message: 'DNS records readable.', evidence: { count: records.length } };
  const expiration: CheckResult = expires ? { status: 'PASS', message: `Expiration known: ${expires}` } : { status: 'UNKNOWN', message: 'Expiration unknown.' };
  const checks = [spf, dkim, dmarc, mx, dns];
  const score = Math.min(100, checks.reduce((s,c)=>s+scoreCheck(c), 0));
  const recommendations = checks.filter(c => c.status !== 'PASS').map(c => c.message);
  return { domain, score, spf, dkim, dmarc, mx, dns, expiration, recommendations, verifiedAt: new Date().toISOString() };
}
