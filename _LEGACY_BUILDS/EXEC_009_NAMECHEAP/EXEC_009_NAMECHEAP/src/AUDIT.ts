// EXEC_009_NAMECHEAP — MILES OS provider module
// Controlled-write compatible. Secrets must come from environment/vault.

import { mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

export type AuditEvent = {
  timestamp: string; missionId?: string; taskId?: string; provider: 'NAMECHEAP';
  operation: string; target?: string; before?: unknown; after?: unknown; result: 'SUCCESS'|'FAILURE'|'BLOCKED'; verification?: unknown; error?: string;
};

export function writeAudit(dir: string, event: AuditEvent): string {
  mkdirSync(dir, { recursive: true });
  const id = `AUDIT_NAMECHEAP_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  appendFileSync(join(dir, 'namecheap_audit.jsonl'), JSON.stringify({ id, ...event }) + '\n');
  return id;
}
