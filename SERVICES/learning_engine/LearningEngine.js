'use strict';

const fs = require('fs');
const path = require('path');

class LearningEngine {
  constructor(options = {}) {
    this.service = 'LEARNING_ENGINE';
    this.version = '1.0.0';

    this.rootDir = options.rootDir || process.cwd();

    this.runtimeDir =
      options.runtimeDir ||
      path.join(this.rootDir, 'runtime');

    this.learningDir =
      options.learningDir ||
      path.join(this.runtimeDir, 'learning_engine');

    this.statePath =
      options.statePath ||
      path.join(this.learningDir, 'learning_state.json');

    this.eventsPath =
      options.eventsPath ||
      path.join(this.learningDir, 'learning_events.jsonl');

    this.recommendationsPath =
      options.recommendationsPath ||
      path.join(this.learningDir, 'learning_recommendations.json');

    this.repeatedFailureThreshold = Number(options.repeatedFailureThreshold || 3);

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      generatedAt: new Date().toISOString(),
      eventsRecorded: 0,
      workerExecutions: 0,
      connectorExecutions: 0,
      operationOutcomes: 0,
      successes: 0,
      failures: 0,
      repeatedFailures: {},
      successRates: {},
      recommendations: [],
      lastEventAt: null,
      lastRecommendationAt: null,
      lastError: null
    };

    this.ensureStorage();
    this.loadState();
  }

  ensureStorage() {
    if (!fs.existsSync(this.learningDir)) {
      fs.mkdirSync(this.learningDir, { recursive: true });
    }

    if (!fs.existsSync(this.eventsPath)) {
      fs.writeFileSync(this.eventsPath, '', 'utf8');
    }

    if (!fs.existsSync(this.recommendationsPath)) {
      fs.writeFileSync(this.recommendationsPath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.statePath)) {
      this.persistState();
    }
  }

  loadState() {
    try {
      if (fs.existsSync(this.statePath)) {
        const raw = fs.readFileSync(this.statePath, 'utf8');
        if (raw.trim()) {
          const loaded = JSON.parse(raw);
          this.state = {
            ...this.state,
            ...loaded,
            service: this.service,
            version: this.version
          };
        }
      }
    } catch (error) {
      this.state.status = 'STATE_LOAD_FAILED';
      this.state.lastError = error.message;
      this.persistState();
    }
  }

  persistState() {
    this.state.generatedAt = new Date().toISOString();
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  appendEvent(event) {
    const payload = {
      ...event,
      recordedAt: new Date().toISOString()
    };

    fs.appendFileSync(this.eventsPath, `${JSON.stringify(payload)}\n`, 'utf8');
  }

  recordWorkerExecution(event = {}) {
    return this.recordEvent({
      ...event,
      eventType: 'WORKER_EXECUTION'
    });
  }

  recordConnectorExecution(event = {}) {
    return this.recordEvent({
      ...event,
      eventType: 'CONNECTOR_EXECUTION'
    });
  }

  recordOperationOutcome(event = {}) {
    return this.recordEvent({
      ...event,
      eventType: 'OPERATION_OUTCOME'
    });
  }

  recordEvent(event = {}) {
    try {
      const normalized = this.normalizeEvent(event);

      this.appendEvent(normalized);
      this.updateMetrics(normalized);

      const recommendations = this.generateRecommendations();

      this.state.status = 'EVENT_RECORDED';
      this.state.eventsRecorded += 1;
      this.state.lastEventAt = new Date().toISOString();
      this.state.lastError = null;
      this.state.recommendations = recommendations;

      this.persistRecommendations(recommendations);
      this.persistState();

      return {
        ok: true,
        service: this.service,
        status: 'EVENT_RECORDED',
        event: normalized,
        recommendations,
        state: this.getState()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'EVENT_RECORD_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      return {
        ok: false,
        service: this.service,
        status: 'EVENT_RECORD_FAILED',
        error: error.message
      };
    }
  }

  normalizeEvent(event = {}) {
    const eventType = event.eventType || event.type || 'UNKNOWN_EVENT';

    const target =
      event.workerId ||
      event.connectorId ||
      event.operationId ||
      event.capabilityId ||
      event.target ||
      'UNKNOWN_TARGET';

    const status = String(event.status || '').toUpperCase();

    const ok =
      typeof event.ok === 'boolean'
        ? event.ok
        : status.includes('COMPLETED') ||
          status.includes('SUCCESS') ||
          status.includes('READY') ||
          status.includes('HEALTHY');

    return {
      eventId: event.eventId || `${eventType}_${target}_${Date.now()}`,
      eventType,
      target,
      ok,
      status: event.status || (ok ? 'SUCCESS' : 'FAILED'),
      error: event.error || null,
      durationMs: typeof event.durationMs === 'number' ? event.durationMs : null,
      metadata: event.metadata || {},
      raw: event.raw || event,
      occurredAt: event.occurredAt || new Date().toISOString()
    };
  }

  updateMetrics(event) {
    if (event.eventType === 'WORKER_EXECUTION') {
      this.state.workerExecutions += 1;
    }

    if (event.eventType === 'CONNECTOR_EXECUTION') {
      this.state.connectorExecutions += 1;
    }

    if (event.eventType === 'OPERATION_OUTCOME') {
      this.state.operationOutcomes += 1;
    }

    if (event.ok) {
      this.state.successes += 1;
      this.clearRepeatedFailure(event.target);
    } else {
      this.state.failures += 1;
      this.trackRepeatedFailure(event);
    }

    this.updateSuccessRate(event);
  }

  trackRepeatedFailure(event) {
    if (!this.state.repeatedFailures[event.target]) {
      this.state.repeatedFailures[event.target] = {
        target: event.target,
        count: 0,
        lastStatus: null,
        lastError: null,
        lastFailureAt: null
      };
    }

    this.state.repeatedFailures[event.target].count += 1;
    this.state.repeatedFailures[event.target].lastStatus = event.status;
    this.state.repeatedFailures[event.target].lastError = event.error;
    this.state.repeatedFailures[event.target].lastFailureAt = new Date().toISOString();
  }

  clearRepeatedFailure(target) {
    if (this.state.repeatedFailures[target]) {
      delete this.state.repeatedFailures[target];
    }
  }

  updateSuccessRate(event) {
    if (!this.state.successRates[event.target]) {
      this.state.successRates[event.target] = {
        target: event.target,
        attempts: 0,
        successes: 0,
        failures: 0,
        successRate: 0
      };
    }

    const rate = this.state.successRates[event.target];

    rate.attempts += 1;

    if (event.ok) {
      rate.successes += 1;
    } else {
      rate.failures += 1;
    }

    rate.successRate =
      rate.attempts === 0
        ? 0
        : Number((rate.successes / rate.attempts).toFixed(4));
  }

  generateRecommendations() {
    const recommendations = [];

    for (const failure of Object.values(this.state.repeatedFailures)) {
      if (failure.count >= this.repeatedFailureThreshold) {
        recommendations.push({
          recommendationId: `REPAIR_${failure.target}_${Date.now()}`,
          type: 'REPAIR_RECOMMENDATION',
          priority: 'HIGH',
          target: failure.target,
          reason: `Repeated failures detected for ${failure.target}`,
          failureCount: failure.count,
          lastStatus: failure.lastStatus,
          lastError: failure.lastError,
          recommendedAction: 'ROUTE_TO_REPAIR_ENGINE',
          createdAt: new Date().toISOString()
        });
      }
    }

    for (const rate of Object.values(this.state.successRates)) {
      if (rate.attempts >= 5 && rate.successRate < 0.5) {
        recommendations.push({
          recommendationId: `CAPABILITY_REVIEW_${rate.target}_${Date.now()}`,
          type: 'CAPABILITY_REVIEW',
          priority: 'MEDIUM',
          target: rate.target,
          reason: `Low success rate detected for ${rate.target}`,
          attempts: rate.attempts,
          successRate: rate.successRate,
          recommendedAction: 'ROUTE_TO_CAPABILITY_BUILDER',
          createdAt: new Date().toISOString()
        });
      }
    }

    this.state.lastRecommendationAt = new Date().toISOString();

    return recommendations;
  }

  persistRecommendations(recommendations) {
    fs.writeFileSync(this.recommendationsPath, JSON.stringify(recommendations, null, 2), 'utf8');
  }

  getRecommendations() {
    try {
      if (!fs.existsSync(this.recommendationsPath)) {
        return {
          ok: true,
          service: this.service,
          status: 'NO_RECOMMENDATIONS',
          recommendations: []
        };
      }

      const raw = fs.readFileSync(this.recommendationsPath, 'utf8');
      const recommendations = raw.trim() ? JSON.parse(raw) : [];

      return {
        ok: true,
        service: this.service,
        status: 'RECOMMENDATIONS_LOADED',
        recommendations
      };
    } catch (error) {
      return {
        ok: false,
        service: this.service,
        status: 'RECOMMENDATIONS_LOAD_FAILED',
        error: error.message
      };
    }
  }

  getMetrics() {
    const total = this.state.successes + this.state.failures;

    return {
      ok: true,
      service: this.service,
      status: 'METRICS_READY',
      metrics: {
        eventsRecorded: this.state.eventsRecorded,
        workerExecutions: this.state.workerExecutions,
        connectorExecutions: this.state.connectorExecutions,
        operationOutcomes: this.state.operationOutcomes,
        successes: this.state.successes,
        failures: this.state.failures,
        overallSuccessRate:
          total === 0 ? 0 : Number((this.state.successes / total).toFixed(4)),
        repeatedFailures: this.state.repeatedFailures,
        successRates: this.state.successRates,
        recommendations: this.state.recommendations
      }
    };
  }

  async healthCheck() {
    const learningDirExists = fs.existsSync(this.learningDir);
    const statePathExists = fs.existsSync(this.statePath);
    const eventsPathExists = fs.existsSync(this.eventsPath);
    const recommendationsPathExists = fs.existsSync(this.recommendationsPath);

    const ok =
      learningDirExists &&
      statePathExists &&
      eventsPathExists &&
      recommendationsPathExists;

    return {
      ok,
      service: this.service,
      version: this.version,
      status: ok ? 'HEALTHY' : 'DEGRADED',
      learningDir: this.learningDir,
      learningDirExists,
      statePath: this.statePath,
      statePathExists,
      eventsPath: this.eventsPath,
      eventsPathExists,
      recommendationsPath: this.recommendationsPath,
      recommendationsPathExists,
      state: this.getState()
    };
  }

  getState() {
    return {
      ...this.state,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = LearningEngine;