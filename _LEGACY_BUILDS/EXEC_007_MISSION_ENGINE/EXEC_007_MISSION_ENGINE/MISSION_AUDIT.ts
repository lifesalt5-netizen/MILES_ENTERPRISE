import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export class MissionAudit {
  constructor(private auditPath = './logs/mission_audit.jsonl') {}

  write(event: Record<string, unknown>): void {
    mkdirSync(dirname(this.auditPath), { recursive: true });
    appendFileSync(this.auditPath, JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + '\n');
  }
}
