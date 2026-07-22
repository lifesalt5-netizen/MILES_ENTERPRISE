'use strict';

const fs = require('fs');
const path = require('path');

class ExecutiveContextService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.logger = options.logger || console;
    this.providers = options.providers || {};
    this.state = {
      generatedAt: new Date().toISOString(),
      companyHealth: 'UNKNOWN',
      revenue: {},
      sales: {},
      marketing: {},
      operations: {},
      executive: {},
      orion: {},
      infrastructure: {}
    };
    this.lastError = null;
  }

  buildContext() {
    const context = {
      generatedAt: new Date().toISOString(),
      companyHealth: 'UNKNOWN',
      revenue: this.collectRevenueContext(),
      sales: this.collectSalesContext(),
      marketing: this.collectMarketingContext(),
      operations: this.collectOperationsContext(),
      executive: this.collectExecutiveContext(),
      orion: this.collectOrionContext(),
      infrastructure: this.collectInfrastructureContext()
    };

    context.companyHealth = this.determineHealth(context);

    this.state = context;
    return this.clone(context);
  }

  getSummary() {
    const context = this.state && Object.keys(this.state).length ? this.state : this.buildContext();
    const summaryParts = [];

    if (context.revenue && context.revenue.monthlyRevenue !== undefined && context.revenue.revenueGoal !== undefined) {
      if (context.revenue.monthlyRevenue < context.revenue.revenueGoal) {
        summaryParts.push('Revenue below target.');
      } else {
        summaryParts.push('Revenue at or above target.');
      }
    }

    if (context.sales && context.sales.positiveReplies !== undefined) {
      if (context.sales.positiveReplies > 0) {
        summaryParts.push(`${context.sales.positiveReplies} positive replies require follow-up.`);
      }
    }

    if (context.sales && context.sales.meetingsScheduled !== undefined && context.sales.meetingsScheduled > 0) {
      summaryParts.push(`${context.sales.meetingsScheduled} meetings are scheduled.`);
    }

    if (context.marketing && context.marketing.deliverabilityStatus) {
      summaryParts.push(`Deliverability ${context.marketing.deliverabilityStatus}.`);
    }

    if (context.executive && context.executive.criticalRisks && context.executive.criticalRisks.length > 0) {
      summaryParts.push(`${context.executive.criticalRisks.length} critical risks require attention.`);
    } else {
      summaryParts.push('No critical risks reported.');
    }

    if (context.infrastructure && context.infrastructure.runtimeHealth) {
      const runtimeHealth = String(context.infrastructure.runtimeHealth).toLowerCase();
      if (runtimeHealth.includes('fail') || runtimeHealth.includes('degraded')) {
        summaryParts.push('Infrastructure health is degraded.');
      } else {
        summaryParts.push('No critical infrastructure failures.');
      }
    } else {
      summaryParts.push('No critical infrastructure failures.');
    }

    return summaryParts.join(' ');
  }

  getExecutiveAlerts() {
    const context = this.state && Object.keys(this.state).length ? this.state : this.buildContext();
    const alerts = [];
    const seenSeverities = new Set();

    const pushAlert = (severity, message) => {
      if (!severity || !message) return;
      const normalized = String(severity).toLowerCase();
      if (!['critical', 'high', 'medium'].includes(normalized)) {
        return;
      }
      if (seenSeverities.has(normalized)) {
        return;
      }
      seenSeverities.add(normalized);
      alerts.push({ severity: normalized, message });
    };

    if (context.executive && Array.isArray(context.executive.executiveAlerts)) {
      context.executive.executiveAlerts.forEach((alert) => {
        if (alert && typeof alert === 'object') {
          pushAlert(alert.severity, alert.message);
        } else if (typeof alert === 'string') {
          pushAlert('medium', alert);
        }
      });
    }

    if (context.executive && context.executive.criticalRisks && context.executive.criticalRisks.length > 0) {
      pushAlert('critical', `${context.executive.criticalRisks.length} critical risks require attention.`);
    }

    if (context.infrastructure && context.infrastructure.runtimeHealth) {
      const runtimeHealth = String(context.infrastructure.runtimeHealth).toLowerCase();
      if (runtimeHealth.includes('fail') || runtimeHealth.includes('degraded')) {
        pushAlert('high', 'Infrastructure runtime health is degraded.');
      }
    }

    return alerts;
  }

  determineHealth(context = this.state) {
    const revenue = context && context.revenue ? context.revenue : {};
    const operations = context && context.operations ? context.operations : {};
    const infrastructure = context && context.infrastructure ? context.infrastructure : {};

    const hasFailures = Number(operations.failedWork || 0) > 0 || String(infrastructure.runtimeHealth || '').toLowerCase().includes('fail');
    const hasDegraded = String(infrastructure.runtimeHealth || '').toLowerCase().includes('degraded');

    if (hasFailures) {
      return 'CRITICAL';
    }

    if (hasDegraded || Number(revenue.monthlyRevenue || 0) < Number(revenue.revenueGoal || 0)) {
      return 'DEGRADED';
    }

    return 'HEALTHY';
  }

  collectRevenueContext() {
    return this.safeCollect('Revenue', 'revenue', {
      monthlyRevenue: 0,
      revenueGoal: 0,
      recurringRevenue: 0,
      qualifiedPipeline: 0,
      proposalsOutstanding: 0
    });
  }

  collectSalesContext() {
    return this.safeCollect('Sales', 'sales', {
      positiveReplies: 0,
      neutralReplies: 0,
      meetingsScheduled: 0,
      followUpsDue: 0
    });
  }

  collectMarketingContext() {
    return this.safeCollect('Marketing', 'marketing', {
      activeCampaigns: 0,
      unhealthyCampaigns: 0,
      deliverabilityStatus: 'UNKNOWN',
      inboxHealth: 'UNKNOWN',
      sendingCapacity: 'UNKNOWN'
    });
  }

  collectOperationsContext() {
    return this.safeCollect('Operations', 'operations', {
      queuedWork: 0,
      runningWork: 0,
      failedWork: 0,
      blockedWork: 0,
      approvalQueue: 0
    });
  }

  collectExecutiveContext() {
    return this.safeCollect('Executive', 'executive', {
      ceoApprovalsRequired: 0,
      criticalRisks: [],
      executiveAlerts: []
    });
  }

  collectOrionContext() {
    return this.safeCollect('Orion', 'orion', {
      contractorRefreshStatus: 'UNKNOWN',
      buyerRefreshStatus: 'UNKNOWN',
      opportunityFreshness: 'UNKNOWN',
      ingestionHealth: 'UNKNOWN'
    });
  }

  collectInfrastructureContext() {
    return this.safeCollect('Infrastructure', 'infrastructure', {
      connectorHealth: 'UNKNOWN',
      runtimeHealth: 'UNKNOWN',
      apiHealth: 'UNKNOWN'
    });
  }

  safeCollect(serviceName, providerKey, fallback) {
    const provider = this.providers && this.providers[providerKey] ? this.providers[providerKey] : null;

    if (!provider || typeof provider !== 'object') {
      this.recordDegradation(serviceName, 'Provider unavailable');
      return this.clone(fallback);
    }

    const source = provider.getContext ? provider.getContext() : provider.getState ? provider.getState() : null;
    if (!source || typeof source !== 'object') {
      this.recordDegradation(serviceName, 'Provider returned no context');
      return this.clone(fallback);
    }

    const normalized = this.normalizeContext(source, fallback);
    return normalized;
  }

  normalizeContext(source, fallback) {
    if (Array.isArray(source)) {
      return this.clone(fallback);
    }

    const normalized = this.clone(fallback);
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        normalized[key] = value.slice();
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        normalized[key] = this.clone(value);
      } else {
        normalized[key] = value;
      }
    }

    return normalized;
  }

  recordDegradation(serviceName, details) {
    if (!this.lastError) {
      this.lastError = { serviceName, details };
    }
    if (this.logger && typeof this.logger.warn === 'function') {
      this.logger.warn(`[ExecutiveContextService] ${serviceName}: ${details}`);
    }
  }

  clone(value) {
    if (Array.isArray(value)) {
      return value.slice();
    }
    if (value && typeof value === 'object') {
      return JSON.parse(JSON.stringify(value));
    }
    return value;
  }
}

module.exports = ExecutiveContextService;
