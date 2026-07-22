'use strict';

const fs = require('fs');
const path = require('path');

class ExecutiveMemoryService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.storageDir = options.storageDir || path.join(this.rootDir, 'DATA', 'executive_memory');
    this.filePath = options.filePath || path.join(this.storageDir, 'executive_memory.json');
    this.backupPath = options.backupPath || path.join(this.storageDir, 'executive_memory.backup.json');
    this.logger = options.logger || console;
    this.state = this.loadMemory();
  }

  recordMissionResult(result = {}) {
    const memory = this.getMemory();
    const missionId = result.missionId || result.id || `mission_${Date.now()}`;
    const missionResult = {
      missionId,
      title: result.title || 'Untitled mission',
      status: result.status || 'UNKNOWN',
      executedAt: result.executedAt || new Date().toISOString(),
      executionTimeMs: Number(result.executionTimeMs || 0) || 0,
      revenueProduced: Number(result.revenueProduced || 0) || 0,
      revenueProtected: Number(result.revenueProtected || 0) || 0,
      outcome: result.outcome || null,
      category: result.category || 'GENERAL',
      requiresCEO: Boolean(result.requiresCEO)
    };

    memory.completedMissions = Array.isArray(memory.completedMissions) ? memory.completedMissions : [];
    memory.failedMissions = Array.isArray(memory.failedMissions) ? memory.failedMissions : [];

    if (missionResult.status === 'FAILED') {
      memory.failedMissions.push(missionResult);
    } else {
      memory.completedMissions.push(missionResult);
    }

    this.updateCounts(memory);
    this.saveMemory(memory);
    return this.clone(missionResult);
  }

  recordDecision(decision = {}) {
    const memory = this.getMemory();
    const entry = {
      recordedAt: decision.recordedAt || new Date().toISOString(),
      missionId: decision.missionId || null,
      title: decision.title || 'Untitled mission',
      score: Number(decision.score || 0) || 0,
      adjustment: Number(decision.adjustment || 0) || 0,
      explanation: decision.explanation || '',
      requiresCEO: Boolean(decision.requiresCEO),
      overridden: Boolean(decision.overridden)
    };

    memory.decisionExplanations = Array.isArray(memory.decisionExplanations) ? memory.decisionExplanations : [];
    memory.historicalExecutiveScores = Array.isArray(memory.historicalExecutiveScores) ? memory.historicalExecutiveScores : [];
    memory.ceoApprovals = Array.isArray(memory.ceoApprovals) ? memory.ceoApprovals : [];
    memory.ceoOverrides = Array.isArray(memory.ceoOverrides) ? memory.ceoOverrides : [];

    memory.decisionExplanations.push(entry);
    memory.historicalExecutiveScores.push({ recordedAt: entry.recordedAt, score: entry.score, missionId: entry.missionId });

    if (entry.requiresCEO) {
      memory.ceoApprovals.push({ recordedAt: entry.recordedAt, missionId: entry.missionId, title: entry.title });
    }

    if (entry.overridden) {
      memory.ceoOverrides.push({ recordedAt: entry.recordedAt, missionId: entry.missionId, title: entry.title });
    }

    this.updateCounts(memory);
    this.saveMemory(memory);
    return this.clone(entry);
  }

  recordOutcome(outcome = {}) {
    const memory = this.getMemory();
    const entry = {
      recordedAt: outcome.recordedAt || new Date().toISOString(),
      type: outcome.type || 'GENERAL',
      detail: outcome.detail || '',
      value: Number(outcome.value || 0) || 0
    };

    if (entry.type === 'MEETING') {
      memory.meetingGeneration = Array.isArray(memory.meetingGeneration) ? memory.meetingGeneration : [];
      memory.meetingGeneration.push(entry);
    } else if (entry.type === 'PROPOSAL') {
      memory.proposalOutcomes = Array.isArray(memory.proposalOutcomes) ? memory.proposalOutcomes : [];
      memory.proposalOutcomes.push(entry);
    } else if (entry.type === 'DELIVERABILITY') {
      memory.deliverabilityIncidents = Array.isArray(memory.deliverabilityIncidents) ? memory.deliverabilityIncidents : [];
      memory.deliverabilityIncidents.push(entry);
    } else if (entry.type === 'INFRASTRUCTURE') {
      memory.infrastructureIncidents = Array.isArray(memory.infrastructureIncidents) ? memory.infrastructureIncidents : [];
      memory.infrastructureIncidents.push(entry);
    }

    this.updateCounts(memory);
    this.saveMemory(memory);
    return this.clone(entry);
  }

  getMissionHistory(limit = 20) {
    const memory = this.getMemory();
    const combined = [
      ...(memory.completedMissions || []),
      ...(memory.failedMissions || [])
    ].sort((left, right) => (right.executedAt || '').localeCompare(left.executedAt || ''));

    return combined.slice(0, limit);
  }

  getLearningSummary() {
    const memory = this.getMemory();
    const completed = memory.completedMissions || [];
    const failed = memory.failedMissions || [];
    const avgExecutionTime = completed.length + failed.length > 0
      ? ((completed.concat(failed)).reduce((total, item) => total + Number(item.executionTimeMs || 0), 0) / (completed.length + failed.length)).toFixed(2)
      : '0.00';

    return {
      completedMissions: completed.length,
      failedMissions: failed.length,
      repeatedFailures: this.findRepeatedPatterns([...completed, ...failed], 'title'),
      repeatedSuccesses: this.findRepeatedPatterns([...completed, ...failed], 'category'),
      averageExecutionTimeMs: Number(avgExecutionTime),
      revenueProduced: (completed || []).reduce((total, item) => total + Number(item.revenueProduced || 0), 0),
      revenueProtected: (completed || []).reduce((total, item) => total + Number(item.revenueProtected || 0), 0),
      meetingGeneration: (memory.meetingGeneration || []).length,
      proposalOutcomes: (memory.proposalOutcomes || []).length,
      deliverabilityIncidents: (memory.deliverabilityIncidents || []).length,
      infrastructureIncidents: (memory.infrastructureIncidents || []).length,
      ceoApprovals: (memory.ceoApprovals || []).length,
      ceoOverrides: (memory.ceoOverrides || []).length
    };
  }

  getRecommendations() {
    const memory = this.getMemory();
    const recommendations = [];
    const proposalOutcomes = memory.proposalOutcomes || [];
    const deliverabilityIncidents = memory.deliverabilityIncidents || [];
    const ceoOverrides = memory.ceoOverrides || [];

    if (proposalOutcomes.length > 0) {
      recommendations.push('Proposal work generates highest ROI.');
    }

    if (deliverabilityIncidents.length > 0) {
      recommendations.push('Marketing repairs reduce failures.');
    }

    if (ceoOverrides.length > 0) {
      recommendations.push('CEO overrides proposal rankings frequently.');
    }

    return recommendations;
  }

  getHealth() {
    const memory = this.getMemory();
    const failed = memory.failedMissions || [];
    const completed = memory.completedMissions || [];
    const failureRate = completed.length + failed.length > 0 ? failed.length / (completed.length + failed.length) : 0;

    if (failed.length > 0 && completed.length === 0) {
      return 'WARN';
    }
    if (failureRate >= 0.5) {
      return 'DEGRADED';
    }
    if (failed.length > 0) {
      return 'WARN';
    }
    return 'HEALTHY';
  }

  getMemory() {
    if (!this.state || typeof this.state !== 'object') {
      this.state = this.loadMemory();
    }
    return this.state;
  }

  loadMemory() {
    try {
      fs.mkdirSync(this.storageDir, { recursive: true });
      if (!fs.existsSync(this.filePath)) {
        return this.createDefaultMemory();
      }

      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Memory file is not a JSON object.');
      }
      return this.normalizeMemory(parsed);
    } catch (error) {
      this.repairMemory(error);
      return this.createDefaultMemory();
    }
  }

  repairMemory(error) {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.copyFileSync(this.filePath, this.backupPath);
      }
    } catch (backupError) {
      this.warn(`Unable to back up memory: ${backupError.message}`);
    }

    this.warn(`Repairing executive memory: ${error.message}`);
  }

  normalizeMemory(raw = {}) {
    const memory = this.createDefaultMemory();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    memory.completedMissions = Array.isArray(source.completedMissions) ? source.completedMissions : [];
    memory.failedMissions = Array.isArray(source.failedMissions) ? source.failedMissions : [];
    memory.repeatedFailures = Array.isArray(source.repeatedFailures) ? source.repeatedFailures : [];
    memory.repeatedSuccesses = Array.isArray(source.repeatedSuccesses) ? source.repeatedSuccesses : [];
    memory.averageExecutionTimeMs = Number(source.averageExecutionTimeMs || 0) || 0;
    memory.revenueProduced = Number(source.revenueProduced || 0) || 0;
    memory.revenueProtected = Number(source.revenueProtected || 0) || 0;
    memory.meetingGeneration = Array.isArray(source.meetingGeneration) ? source.meetingGeneration : [];
    memory.proposalOutcomes = Array.isArray(source.proposalOutcomes) ? source.proposalOutcomes : [];
    memory.deliverabilityIncidents = Array.isArray(source.deliverabilityIncidents) ? source.deliverabilityIncidents : [];
    memory.infrastructureIncidents = Array.isArray(source.infrastructureIncidents) ? source.infrastructureIncidents : [];
    memory.ceoApprovals = Array.isArray(source.ceoApprovals) ? source.ceoApprovals : [];
    memory.ceoOverrides = Array.isArray(source.ceoOverrides) ? source.ceoOverrides : [];
    memory.decisionExplanations = Array.isArray(source.decisionExplanations) ? source.decisionExplanations : [];
    memory.historicalExecutiveScores = Array.isArray(source.historicalExecutiveScores) ? source.historicalExecutiveScores : [];

    return memory;
  }

  createDefaultMemory() {
    return {
      completedMissions: [],
      failedMissions: [],
      repeatedFailures: [],
      repeatedSuccesses: [],
      averageExecutionTimeMs: 0,
      revenueProduced: 0,
      revenueProtected: 0,
      meetingGeneration: [],
      proposalOutcomes: [],
      deliverabilityIncidents: [],
      infrastructureIncidents: [],
      ceoApprovals: [],
      ceoOverrides: [],
      decisionExplanations: [],
      historicalExecutiveScores: []
    };
  }

  updateCounts(memory) {
    const allMissions = [...(memory.completedMissions || []), ...(memory.failedMissions || [])];
    memory.repeatedFailures = this.findRepeatedPatterns(allMissions, 'title');
    memory.repeatedSuccesses = this.findRepeatedPatterns(memory.completedMissions || [], 'category');
    memory.averageExecutionTimeMs = this.calculateAverageExecutionTime(memory);
    memory.revenueProduced = (memory.completedMissions || []).reduce((total, item) => total + Number(item.revenueProduced || 0), 0);
    memory.revenueProtected = (memory.completedMissions || []).reduce((total, item) => total + Number(item.revenueProtected || 0), 0);
  }

  calculateAverageExecutionTime(memory) {
    const all = [...(memory.completedMissions || []), ...(memory.failedMissions || [])];
    if (all.length === 0) {
      return 0;
    }

    const total = all.reduce((sum, item) => sum + Number(item.executionTimeMs || 0), 0);
    return Number((total / all.length).toFixed(2));
  }

  findRepeatedPatterns(items = [], key = 'title') {
    const counts = new Map();
    items.forEach((item) => {
      const identifier = String(item && item[key] || '').trim();
      if (!identifier) {
        return;
      }
      counts.set(identifier, (counts.get(identifier) || 0) + 1);
    });

    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([name, count]) => ({ name, count }));
  }

  saveMemory(memory) {
    try {
      fs.mkdirSync(this.storageDir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.normalizeMemory(memory), null, 2), 'utf8');
      this.state = this.normalizeMemory(memory);
    } catch (error) {
      this.warn(`Unable to save executive memory: ${error.message}`);
    }
  }

  warn(message) {
    if (this.logger && typeof this.logger.warn === 'function') {
      this.logger.warn(message);
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

module.exports = ExecutiveMemoryService;
