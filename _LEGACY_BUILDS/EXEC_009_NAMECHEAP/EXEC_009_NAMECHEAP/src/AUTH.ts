// EXEC_009_NAMECHEAP — MILES OS provider module
// Controlled-write compatible. Secrets must come from environment/vault.

import { NamecheapConfig, validateConfig } from './CONFIG';

export class NamecheapAuth {
  constructor(private config: NamecheapConfig) {}

  assertReady(): void {
    const missing = validateConfig(this.config);
    if (missing.length) {
      throw new Error(`Namecheap credentials/config pending: ${missing.join(', ')}`);
    }
  }

  baseUrl(): string {
    return this.config.sandbox
      ? 'https://api.sandbox.namecheap.com/xml.response'
      : 'https://api.namecheap.com/xml.response';
  }

  baseParams(): URLSearchParams {
    this.assertReady();
    return new URLSearchParams({
      ApiUser: this.config.apiUser,
      ApiKey: this.config.apiKey,
      UserName: this.config.username,
      ClientIp: this.config.clientIp
    });
  }
}
