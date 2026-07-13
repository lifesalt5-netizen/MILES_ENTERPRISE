// EXEC_009_NAMECHEAP — MILES OS provider module
// Controlled-write compatible. Secrets must come from environment/vault.

import { DNSRecord } from './MODELS';

export function detectDrift(current: DNSRecord[], expected: DNSRecord[]): { drift: boolean; missing: DNSRecord[]; extra: DNSRecord[] } {
  const key = (r: DNSRecord) => `${r.host}|${r.type}|${r.value}`.toLowerCase();
  const cur = new Set(current.map(key));
  const exp = new Set(expected.map(key));
  return {
    drift: expected.some(r => !cur.has(key(r))) || current.some(r => !exp.has(key(r))),
    missing: expected.filter(r => !cur.has(key(r))),
    extra: current.filter(r => !exp.has(key(r)))
  };
}
