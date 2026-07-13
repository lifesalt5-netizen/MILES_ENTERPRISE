// EXEC_009_NAMECHEAP — MILES OS provider module
// Controlled-write compatible. Secrets must come from environment/vault.

export type DNSRecordType = 'A'|'AAAA'|'CNAME'|'MX'|'TXT'|'SRV'|'CAA'|'NS'|'URL'|'FRAME';

export type DNSRecord = {
  host: string;
  type: DNSRecordType;
  value: string;
  ttl?: number;
  mxPref?: number;
};

export type DomainInventoryRecord = {
  domain: string;
  registrar: 'Namecheap';
  status: string;
  expires?: string;
  nameservers?: string[];
  workspaceEnabled?: boolean;
  instantlyEnabled?: boolean;
  mailboxCount?: number;
  dailyCapacity?: number;
  lastVerified?: string;
};

export type DomainHealth = {
  domain: string;
  score: number;
  spf: CheckResult;
  dkim: CheckResult;
  dmarc: CheckResult;
  mx: CheckResult;
  dns: CheckResult;
  expiration: CheckResult;
  recommendations: string[];
  verifiedAt: string;
};

export type CheckResult = {
  status: 'PASS'|'WARN'|'FAIL'|'UNKNOWN';
  message: string;
  evidence?: unknown;
};

export type ProviderAction = {
  missionId?: string;
  taskId?: string;
  capability: string;
  params: Record<string, unknown>;
  controlledWrite?: boolean;
};

export type ProviderResult = {
  ok: boolean;
  capability: string;
  data?: unknown;
  error?: string;
  verification?: unknown;
  auditId?: string;
};
