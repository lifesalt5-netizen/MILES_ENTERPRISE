// EXEC_009_NAMECHEAP — MILES OS provider module
// Controlled-write compatible. Secrets must come from environment/vault.

export type NamecheapConfig = {
  apiUser: string;
  apiKey: string;
  username: string;
  clientIp: string;
  sandbox: boolean;
  controlledWrites: boolean;
  auditDir: string;
  stateDir: string;
};

export function loadNamecheapConfig(env: NodeJS.ProcessEnv = process.env): NamecheapConfig {
  return {
    apiUser: env.NAMECHEAP_API_USER || '',
    apiKey: env.NAMECHEAP_API_KEY || '',
    username: env.NAMECHEAP_USERNAME || '',
    clientIp: env.NAMECHEAP_CLIENT_IP || '',
    sandbox: (env.NAMECHEAP_SANDBOX || 'true').toLowerCase() === 'true',
    controlledWrites: (env.MILES_CONTROLLED_WRITES || 'false').toLowerCase() === 'true',
    auditDir: env.MILES_AUDIT_DIR || './audit',
    stateDir: env.MILES_STATE_DIR || './state'
  };
}

export function validateConfig(config: NamecheapConfig): string[] {
  const missing: string[] = [];
  for (const key of ['apiUser','apiKey','username','clientIp'] as const) {
    if (!config[key]) missing.push(key);
  }
  return missing;
}
