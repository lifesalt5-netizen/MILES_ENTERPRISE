// EXEC_009_NAMECHEAP — MILES OS provider module
// Controlled-write compatible. Secrets must come from environment/vault.

import { loadNamecheapConfig, NamecheapConfig } from './CONFIG';
import { ProviderAction, ProviderResult } from './MODELS';
import { DomainController } from './DOMAIN_CONTROLLER';
import { DNSController } from './DNS_CONTROLLER';
import { calculateDomainHealth } from './HEALTH';
import { requiresApproval } from './GOVERNANCE';
import { writeAudit } from './AUDIT';

export class NamecheapProvider {
  private domainController = new DomainController();
  private dnsController = new DNSController();

  constructor(private config: NamecheapConfig = loadNamecheapConfig()) {}

  capabilities(): string[] {
    return ['ListDomains','GetDomain','GetDNS','UpdateDNS','VerifyDNS','SPFManager','DKIMManager','DMARCManager','MXManager','HealthCheck','DomainInventory','SyncRegistry','DriftDetection'];
  }

  async execute(action: ProviderAction): Promise<ProviderResult> {
    if (requiresApproval(action.capability, this.config.controlledWrites)) {
      const auditId = writeAudit(this.config.auditDir, {
        timestamp: new Date().toISOString(), missionId: action.missionId, taskId: action.taskId, provider: 'NAMECHEAP', operation: action.capability,
        target: String(action.params.domain || ''), result: 'BLOCKED', error: 'Governance approval or controlled writes required.'
      });
      return { ok: false, capability: action.capability, error: 'Governance approval or controlled writes required.', auditId };
    }

    try {
      let data: unknown;
      switch (action.capability) {
        case 'ListDomains': data = await this.domainController.listDomains(); break;
        case 'GetDomain': data = await this.domainController.getDomain(String(action.params.domain)); break;
        case 'GetDNS': data = await this.dnsController.getDNS(String(action.params.domain)); break;
        case 'HealthCheck': {
          const domain = String(action.params.domain);
          const records = await this.dnsController.getDNS(domain);
          data = calculateDomainHealth(domain, records);
          break;
        }
        case 'UpdateDNS': data = await this.dnsController.updateDNS(String(action.params.domain), action.params.records as any[], this.config.controlledWrites); break;
        default: throw new Error(`Unsupported capability: ${action.capability}`);
      }
      const auditId = writeAudit(this.config.auditDir, { timestamp: new Date().toISOString(), missionId: action.missionId, taskId: action.taskId, provider: 'NAMECHEAP', operation: action.capability, target: String(action.params.domain || ''), after: data, result: 'SUCCESS' });
      return { ok: true, capability: action.capability, data, auditId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const auditId = writeAudit(this.config.auditDir, { timestamp: new Date().toISOString(), missionId: action.missionId, taskId: action.taskId, provider: 'NAMECHEAP', operation: action.capability, target: String(action.params.domain || ''), result: 'FAILURE', error: message });
      return { ok: false, capability: action.capability, error: message, auditId };
    }
  }
}
