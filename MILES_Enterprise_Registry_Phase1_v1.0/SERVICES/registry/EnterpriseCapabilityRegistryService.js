'use strict';

const fs = require('fs');
const path = require('path');

class EnterpriseCapabilityRegistryService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.cwd());
    this.runtimeDir = path.resolve(
      options.runtimeDir || path.join(this.rootDir, 'runtime', 'enterprise_registry')
    );
    this.componentRegistryPath = path.join(this.runtimeDir, 'component_registry.json');
    this.capabilityRegistryPath = path.join(this.runtimeDir, 'capability_registry.json');
    this.routingTablePath = path.join(this.runtimeDir, 'capability_routing_table.json');
    this.summaryPath = path.join(this.runtimeDir, 'capability_registry_summary.json');
    this.service = 'ENTERPRISE_CAPABILITY_REGISTRY';
    this.version = '1.0.0';
    fs.mkdirSync(this.runtimeDir, { recursive: true });
  }

  now() {
    return new Date().toISOString();
  }

  loadComponents() {
    const parsed = JSON.parse(fs.readFileSync(this.componentRegistryPath, 'utf8'));
    return Array.isArray(parsed.components) ? parsed.components : [];
  }

  inferCapabilities(component) {
    const capabilities = new Set(component.supportedActions || []);
    const source = `${component.name} ${component.relativePath} ${(component.categories || []).join(' ')}`.toUpperCase();

    const rules = [
      [/INSTANTLY/, ['SYNC_CAMPAIGNS', 'SYNC_SEGMENTS', 'UPLOAD_LEADS', 'CHECK_DELIVERABILITY']],
      [/WEBSITE/, ['AUDIT_WEBSITE', 'QUEUE_WEBSITE_CHANGE', 'PUBLISH_WEBSITE_CHANGE']],
      [/GOOGLE|GMAIL/, ['READ_EMAIL', 'SEND_EMAIL', 'MANAGE_GOOGLE_ACCOUNT']],
      [/CALENDAR|CALENDLY/, ['READ_CALENDAR', 'CREATE_CALENDAR_EVENT', 'SYNC_SCHEDULING']],
      [/NAMECHEAP|DNS/, ['READ_DNS', 'UPDATE_DNS', 'CHECK_DOMAIN_HEALTH']],
      [/IONOS/, ['MANAGE_IONOS', 'CHECK_HOSTING_HEALTH']],
      [/PROPOSAL/, ['ANALYZE_SOLICITATION', 'BUILD_COMPLIANCE_MATRIX', 'MANAGE_PROPOSAL']],
      [/ORION/, ['QUERY_ORION', 'SCORE_CONTRACTOR', 'SCORE_OPPORTUNITY']],
      [/SALES|CRM/, ['MANAGE_PIPELINE', 'QUALIFY_LEAD', 'CREATE_FOLLOW_UP']],
      [/MARKETING/, ['PLAN_CAMPAIGN', 'MANAGE_MARKETING']],
      [/PLANNER/, ['CREATE_PLAN', 'PRIORITIZE_WORK']],
      [/SCHEDULER|CRON/, ['SCHEDULE_WORK']],
      [/DASHBOARD|REPORT/, ['GENERATE_EXECUTIVE_REPORT']],
      [/HEALTH|SUPERVISOR/, ['RUN_HEALTH_CHECK', 'RECOVER_SERVICE']],
      [/APPROVAL|DECISION|GOVERNANCE/, ['REQUEST_APPROVAL', 'EVALUATE_AUTHORITY']]
    ];

    for (const [pattern, names] of rules) {
      if (pattern.test(source)) names.forEach(name => capabilities.add(name));
    }

    return [...capabilities].sort();
  }

  capabilityRisk(name) {
    const highRisk = [
      'SEND_EMAIL', 'START_CAMPAIGN', 'RESUME_CAMPAIGN',
      'DELETE_CAMPAIGN', 'DELETE_LEADS', 'UPDATE_DNS',
      'PUBLISH_WEBSITE_CHANGE', 'MANAGE_GOOGLE_ACCOUNT'
    ];
    const mediumRisk = [
      'UPLOAD_LEADS', 'CREATE_CALENDAR_EVENT',
      'QUEUE_WEBSITE_CHANGE', 'CREATE_FOLLOW_UP'
    ];

    if (highRisk.includes(name)) return 'HIGH';
    if (mediumRisk.includes(name)) return 'MEDIUM';
    return 'LOW';
  }

  build() {
    if (!fs.existsSync(this.componentRegistryPath)) {
      throw new Error('Component registry does not exist. Run the component registry first.');
    }

    const components = this.loadComponents();
    const capabilityMap = new Map();

    for (const component of components) {
      const capabilities = this.inferCapabilities(component);

      for (const capabilityName of capabilities) {
        if (!capabilityMap.has(capabilityName)) {
          capabilityMap.set(capabilityName, {
            capabilityId: `CAP_${capabilityName}`,
            name: capabilityName,
            riskLevel: this.capabilityRisk(capabilityName),
            providers: [],
            status: 'AVAILABLE',
            generatedAt: this.now()
          });
        }

        capabilityMap.get(capabilityName).providers.push({
          componentId: component.componentId,
          componentName: component.name,
          relativePath: component.relativePath,
          primaryType: component.primaryType,
          componentStatus: component.status,
          approvalRequired: (component.approvalRequiredActions || []).includes(capabilityName),
          modifiedAt: component.modifiedAt
        });
      }
    }

    const capabilities = [...capabilityMap.values()]
      .map(capability => ({
        ...capability,
        providerCount: capability.providers.length,
        preferredProvider: this.selectPreferredProvider(capability.providers)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const routingTable = capabilities.reduce((result, capability) => {
      result[capability.name] = {
        capabilityId: capability.capabilityId,
        riskLevel: capability.riskLevel,
        preferredProvider: capability.preferredProvider,
        fallbackProviders: capability.providers
          .filter(provider =>
            !capability.preferredProvider ||
            provider.componentId !== capability.preferredProvider.componentId
          )
          .slice(0, 5)
      };
      return result;
    }, {});

    const summary = {
      ok: true,
      service: this.service,
      version: this.version,
      capabilityCount: capabilities.length,
      providerAssignmentCount: capabilities.reduce((sum, item) => sum + item.providerCount, 0),
      highRiskCapabilityCount: capabilities.filter(item => item.riskLevel === 'HIGH').length,
      mediumRiskCapabilityCount: capabilities.filter(item => item.riskLevel === 'MEDIUM').length,
      lowRiskCapabilityCount: capabilities.filter(item => item.riskLevel === 'LOW').length,
      generatedAt: this.now()
    };

    fs.writeFileSync(
      this.capabilityRegistryPath,
      JSON.stringify({ ...summary, capabilities }, null, 2),
      'utf8'
    );
    fs.writeFileSync(this.routingTablePath, JSON.stringify(routingTable, null, 2), 'utf8');
    fs.writeFileSync(this.summaryPath, JSON.stringify(summary, null, 2), 'utf8');

    return summary;
  }

  selectPreferredProvider(providers) {
    if (!providers.length) return null;

    const rank = provider => {
      let score = 0;
      if (provider.componentStatus === 'DISCOVERED') score += 5;
      if (provider.primaryType === 'WORKER') score += 4;
      if (provider.primaryType === 'CONNECTOR') score += 3;
      if (!provider.relativePath.includes('_REFERENCE')) score += 2;
      if (!provider.relativePath.includes('_LEGACY_BUILDS')) score += 2;
      score += new Date(provider.modifiedAt).getTime() / 1e15;
      return score;
    };

    return [...providers].sort((a, b) => rank(b) - rank(a))[0];
  }

  resolve(capabilityName) {
    if (!fs.existsSync(this.capabilityRegistryPath)) {
      return { ok: false, status: 'CAPABILITY_REGISTRY_NOT_BUILT', capabilityName };
    }

    const parsed = JSON.parse(fs.readFileSync(this.capabilityRegistryPath, 'utf8'));
    const capability = (parsed.capabilities || []).find(item => item.name === capabilityName);

    if (!capability) {
      return { ok: false, status: 'CAPABILITY_NOT_FOUND', capabilityName };
    }

    return {
      ok: true,
      status: 'CAPABILITY_RESOLVED',
      capabilityName,
      riskLevel: capability.riskLevel,
      preferredProvider: capability.preferredProvider,
      fallbackProviders: capability.providers.filter(provider =>
        !capability.preferredProvider ||
        provider.componentId !== capability.preferredProvider.componentId
      )
    };
  }

  healthCheck() {
    const ok = [
      this.capabilityRegistryPath,
      this.routingTablePath,
      this.summaryPath
    ].every(filePath => fs.existsSync(filePath));

    return {
      ok,
      service: this.service,
      version: this.version,
      status: ok ? 'HEALTHY' : 'NOT_INITIALIZED',
      generatedAt: this.now()
    };
  }
}

module.exports = EnterpriseCapabilityRegistryService;
