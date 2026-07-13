'use strict';

const fs = require('fs');
const path = require('path');

class CapabilityDeploymentEngine {
  constructor(options = {}) {
    this.service = 'CAPABILITY_DEPLOYMENT_ENGINE';
    this.version = '1.0.0';

    this.rootDir = options.rootDir || process.cwd();

    this.capabilityBuilder = options.capabilityBuilder || null;
    this.workerRegistry = options.workerRegistry || null;
    this.workerRuntimeManager = options.workerRuntimeManager || null;
    this.connectorRuntimeManager = options.connectorRuntimeManager || null;
    this.learningEngineManager = options.learningEngineManager || null;
    this.executiveIntelligence = options.executiveIntelligence || null;

    this.runtimeDir =
      options.runtimeDir ||
      path.join(this.rootDir, 'runtime');

    this.capabilityDir =
      options.capabilityDir ||
      path.join(this.rootDir, 'capabilities');

    this.workerDir =
      options.workerDir ||
      path.join(this.rootDir, 'workers');

    this.deploymentDir =
      options.deploymentDir ||
      path.join(this.runtimeDir, 'capability_deployment');

    this.statePath =
      options.statePath ||
      path.join(this.deploymentDir, 'capability_deployment_state.json');

    this.deploymentRegistryPath =
      options.deploymentRegistryPath ||
      path.join(this.deploymentDir, 'deployment_registry.json');

    this.deploymentLogPath =
      options.deploymentLogPath ||
      path.join(this.deploymentDir, 'deployment_log.jsonl');

    this.failedDeploymentLogPath =
      options.failedDeploymentLogPath ||
      path.join(this.deploymentDir, 'failed_deployments.jsonl');

    this.rollbackLogPath =
      options.rollbackLogPath ||
      path.join(this.deploymentDir, 'rollback_log.jsonl');

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      generatedAt: new Date().toISOString(),
      capabilitiesDiscovered: 0,
      deploymentsAttempted: 0,
      deploymentsCompleted: 0,
      deploymentsFailed: 0,
      rollbacksAttempted: 0,
      rollbacksCompleted: 0,
      registryEntries: 0,
      lastDiscoveryAt: null,
      lastDeploymentAt: null,
      lastRollbackAt: null,
      lastCapability: null,
      lastDeployment: null,
      lastRollback: null,
      lastError: null
    };

    this.ensureStorage();
    this.loadState();
  }

  ensureStorage() {
    if (!fs.existsSync(this.deploymentDir)) {
      fs.mkdirSync(this.deploymentDir, { recursive: true });
    }

    if (!fs.existsSync(this.capabilityDir)) {
      fs.mkdirSync(this.capabilityDir, { recursive: true });
    }

    if (!fs.existsSync(this.workerDir)) {
      fs.mkdirSync(this.workerDir, { recursive: true });
    }

    if (!fs.existsSync(this.deploymentRegistryPath)) {
      fs.writeFileSync(this.deploymentRegistryPath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.deploymentLogPath)) {
      fs.writeFileSync(this.deploymentLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.failedDeploymentLogPath)) {
      fs.writeFileSync(this.failedDeploymentLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.rollbackLogPath)) {
      fs.writeFileSync(this.rollbackLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.statePath)) {
      this.persistState();
    }
  }

  loadState() {
    try {
      if (!fs.existsSync(this.statePath)) {
        return;
      }

      const raw = fs.readFileSync(this.statePath, 'utf8');

      if (!raw.trim()) {
        return;
      }

      const loaded = JSON.parse(raw);

      this.state = {
        ...this.state,
        ...loaded,
        service: this.service,
        version: this.version
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'STATE_LOAD_FAILED';
      this.state.lastError = error.message;
      this.persistState();
    }
  }

  persistState() {
    this.state.generatedAt = new Date().toISOString();
    fs.writeFileSync(this.statePath, JSON.stringify(this.getState(), null, 2), 'utf8');
  }

  appendJsonLine(filePath, payload) {
    fs.appendFileSync(
      filePath,
      `${JSON.stringify({
        ...payload,
        loggedAt: new Date().toISOString()
      })}\n`,
      'utf8'
    );
  }

  readDeploymentRegistry() {
    try {
      if (!fs.existsSync(this.deploymentRegistryPath)) {
        fs.writeFileSync(this.deploymentRegistryPath, JSON.stringify([], null, 2), 'utf8');
      }

      const raw = fs.readFileSync(this.deploymentRegistryPath, 'utf8');

      if (!raw.trim()) {
        return [];
      }

      const parsed = JSON.parse(raw);

      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'DEPLOYMENT_REGISTRY_READ_FAILED';
      this.state.lastError = error.message;
      this.persistState();
      return [];
    }
  }

  writeDeploymentRegistry(registry) {
    fs.writeFileSync(this.deploymentRegistryPath, JSON.stringify(registry, null, 2), 'utf8');
    this.state.registryEntries = registry.length;
    this.persistState();
  }

  discoverCapabilities() {
    try {
      const capabilities = [];

      if (!fs.existsSync(this.capabilityDir)) {
        fs.mkdirSync(this.capabilityDir, { recursive: true });
      }

      const entries = fs.readdirSync(this.capabilityDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.js')) {
          const capabilityId = path.basename(entry.name, '.js');

          capabilities.push({
            capabilityId,
            capabilityPath: path.join(this.capabilityDir, entry.name),
            type: 'file',
            status: 'DISCOVERED'
          });
        }

        if (entry.isDirectory()) {
          const indexPath = path.join(this.capabilityDir, entry.name, 'index.js');
          const namedPath = path.join(this.capabilityDir, entry.name, `${entry.name}.js`);
          const manifestPath = path.join(this.capabilityDir, entry.name, 'capability.json');

          let capabilityPath = null;

          if (fs.existsSync(indexPath)) {
            capabilityPath = indexPath;
          } else if (fs.existsSync(namedPath)) {
            capabilityPath = namedPath;
          }

          if (capabilityPath) {
            capabilities.push({
              capabilityId: entry.name,
              capabilityPath,
              manifestPath: fs.existsSync(manifestPath) ? manifestPath : null,
              type: 'directory',
              status: 'DISCOVERED'
            });
          }
        }
      }

      this.state.status = 'CAPABILITIES_DISCOVERED';
      this.state.capabilitiesDiscovered = capabilities.length;
      this.state.lastDiscoveryAt = new Date().toISOString();
      this.state.lastError = null;
      this.persistState();

      return {
        ok: true,
        service: this.service,
        status: 'CAPABILITIES_DISCOVERED',
        capabilities
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'CAPABILITY_DISCOVERY_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      return {
        ok: false,
        service: this.service,
        status: 'CAPABILITY_DISCOVERY_FAILED',
        error: error.message
      };
    }
  }

  loadManifest(capability = {}) {
    if (!capability.manifestPath || !fs.existsSync(capability.manifestPath)) {
      return {
        capabilityId: capability.capabilityId,
        workerId: capability.capabilityId,
        name: capability.capabilityId,
        version: '1.0.0',
        type: 'worker',
        enabled: true,
        requiresConnectorRefresh: false,
        metadata: {}
      };
    }

    try {
      const raw = fs.readFileSync(capability.manifestPath, 'utf8');
      const parsed = raw.trim() ? JSON.parse(raw) : {};

      return {
        capabilityId: capability.capabilityId,
        workerId: parsed.workerId || parsed.id || capability.capabilityId,
        name: parsed.name || capability.capabilityId,
        version: parsed.version || '1.0.0',
        type: parsed.type || 'worker',
        enabled: parsed.enabled !== false,
        requiresConnectorRefresh: Boolean(parsed.requiresConnectorRefresh),
        metadata: parsed.metadata || parsed
      };
    } catch (error) {
      return {
        capabilityId: capability.capabilityId,
        workerId: capability.capabilityId,
        name: capability.capabilityId,
        version: '1.0.0',
        type: 'worker',
        enabled: false,
        requiresConnectorRefresh: false,
        manifestError: error.message,
        metadata: {}
      };
    }
  }

  validateCapability(capability = {}) {
    const manifest = this.loadManifest(capability);
    const errors = [];

    if (!capability.capabilityId) {
      errors.push('Missing capabilityId.');
    }

    if (!capability.capabilityPath) {
      errors.push('Missing capabilityPath.');
    }

    if (capability.capabilityPath && !fs.existsSync(capability.capabilityPath)) {
      errors.push(`Capability file does not exist: ${capability.capabilityPath}`);
    }

    if (!manifest.enabled) {
      errors.push('Capability manifest is disabled or invalid.');
    }

    if (manifest.manifestError) {
      errors.push(`Manifest error: ${manifest.manifestError}`);
    }

    if (manifest.type !== 'worker') {
      errors.push(`Unsupported capability type: ${manifest.type}`);
    }

    return {
      ok: errors.length === 0,
      service: this.service,
      status: errors.length === 0 ? 'CAPABILITY_READY' : 'CAPABILITY_NOT_READY',
      capability,
      manifest,
      errors
    };
  }

  deployCapability(capability = {}) {
    const deploymentId =
      capability.deploymentId ||
      `DEPLOY_${capability.capabilityId || 'UNKNOWN'}_${Date.now()}`;

    this.state.deploymentsAttempted += 1;
    this.state.lastDeploymentAt = new Date().toISOString();

    try {
      const validation = this.validateCapability(capability);

      if (!validation.ok) {
        throw new Error(validation.errors.join(' '));
      }

      const manifest = validation.manifest;
      const workerId = manifest.workerId || capability.capabilityId;
      const targetWorkerPath = path.join(this.workerDir, `${workerId}.js`);

      const previousWorkerPath = fs.existsSync(targetWorkerPath)
        ? this.createBackup(targetWorkerPath, deploymentId)
        : null;

      fs.copyFileSync(capability.capabilityPath, targetWorkerPath);

      const registryResult = this.registerWorker({
        workerId,
        workerPath: targetWorkerPath,
        capabilityId: capability.capabilityId,
        deploymentId,
        status: 'DEPLOYED',
        deployedAt: new Date().toISOString(),
        manifest
      });

      const workerRefresh = this.refreshWorkerRuntime();
      const connectorRefresh = manifest.requiresConnectorRefresh
        ? this.refreshConnectorRuntime()
        : {
            ok: true,
            service: this.service,
            status: 'CONNECTOR_REFRESH_NOT_REQUIRED'
          };

      const deployment = {
        deploymentId,
        capabilityId: capability.capabilityId,
        workerId,
        capabilityPath: capability.capabilityPath,
        workerPath: targetWorkerPath,
        previousWorkerPath,
        manifest,
        registryResult,
        workerRefresh,
        connectorRefresh,
        status: 'DEPLOYED',
        deployedAt: new Date().toISOString()
      };

      this.addDeploymentRegistryEntry(deployment);

      this.state.deploymentsCompleted += 1;
      this.state.status = 'CAPABILITY_DEPLOYED';
      this.state.lastCapability = capability;
      this.state.lastDeployment = deployment;
      this.state.lastError = null;

      this.appendJsonLine(this.deploymentLogPath, deployment);
      this.persistState();

      this.recordLearningEvent({
        eventType: 'OPERATION_OUTCOME',
        target: workerId,
        ok: true,
        status: 'CAPABILITY_DEPLOYED',
        raw: deployment
      });

      this.updateExecutiveIntelligence(deployment);

      return {
        ok: true,
        service: this.service,
        status: 'CAPABILITY_DEPLOYED',
        deployment,
        state: this.getState()
      };
    } catch (error) {
      this.state.deploymentsFailed += 1;
      this.state.status = 'CAPABILITY_DEPLOYMENT_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      const failure = {
        deploymentId,
        capability,
        error: error.message,
        failedAt: new Date().toISOString()
      };

      this.appendJsonLine(this.failedDeploymentLogPath, failure);

      this.recordLearningEvent({
        eventType: 'OPERATION_OUTCOME',
        target: capability.capabilityId || deploymentId,
        ok: false,
        status: 'CAPABILITY_DEPLOYMENT_FAILED',
        error: error.message,
        raw: failure
      });

      return {
        ok: false,
        service: this.service,
        status: 'CAPABILITY_DEPLOYMENT_FAILED',
        deploymentId,
        error: error.message,
        state: this.getState()
      };
    }
  }

  deployAllReadyCapabilities() {
    const discovery = this.discoverCapabilities();

    if (!discovery.ok) {
      return discovery;
    }

    const results = [];

    for (const capability of discovery.capabilities) {
      const alreadyDeployed = this.isCapabilityAlreadyDeployed(capability.capabilityId);

      if (alreadyDeployed) {
        results.push({
          ok: true,
          service: this.service,
          status: 'CAPABILITY_ALREADY_DEPLOYED',
          capabilityId: capability.capabilityId
        });
        continue;
      }

      results.push(this.deployCapability(capability));
    }

    const deployed = results.filter((result) => result.ok && result.status === 'CAPABILITY_DEPLOYED').length;
    const skipped = results.filter((result) => result.status === 'CAPABILITY_ALREADY_DEPLOYED').length;
    const failed = results.filter((result) => !result.ok).length;

    return {
      ok: failed === 0,
      service: this.service,
      status: failed === 0 ? 'CAPABILITY_DEPLOYMENT_BATCH_COMPLETE' : 'CAPABILITY_DEPLOYMENT_BATCH_WITH_ERRORS',
      discovered: discovery.capabilities.length,
      deployed,
      skipped,
      failed,
      results
    };
  }

  createBackup(filePath, deploymentId) {
    const backupDir = path.join(this.deploymentDir, 'backups', deploymentId);

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupPath = path.join(backupDir, path.basename(filePath));
    fs.copyFileSync(filePath, backupPath);

    return backupPath;
  }

  registerWorker(workerDefinition = {}) {
    if (!this.workerRegistry) {
      return {
        ok: false,
        service: this.service,
        status: 'WORKER_REGISTRY_UNAVAILABLE'
      };
    }

    if (typeof this.workerRegistry.registerWorker === 'function') {
      return this.workerRegistry.registerWorker(workerDefinition);
    }

    if (typeof this.workerRegistry.register === 'function') {
      return this.workerRegistry.register(workerDefinition);
    }

    if (typeof this.workerRegistry.addWorker === 'function') {
      return this.workerRegistry.addWorker(workerDefinition);
    }

    return {
      ok: false,
      service: this.service,
      status: 'WORKER_REGISTRY_REGISTER_METHOD_UNAVAILABLE'
    };
  }

  refreshWorkerRuntime() {
    if (!this.workerRuntimeManager) {
      return {
        ok: false,
        service: this.service,
        status: 'WORKER_RUNTIME_MANAGER_UNAVAILABLE'
      };
    }

    if (typeof this.workerRuntimeManager.runCycle === 'function') {
      return this.workerRuntimeManager.runCycle();
    }

    if (
      this.workerRuntimeManager.runtime &&
      typeof this.workerRuntimeManager.runtime.discoverWorkers === 'function'
    ) {
      return this.workerRuntimeManager.runtime.discoverWorkers();
    }

    return {
      ok: false,
      service: this.service,
      status: 'WORKER_RUNTIME_REFRESH_METHOD_UNAVAILABLE'
    };
  }

  refreshConnectorRuntime() {
    if (!this.connectorRuntimeManager) {
      return {
        ok: false,
        service: this.service,
        status: 'CONNECTOR_RUNTIME_MANAGER_UNAVAILABLE'
      };
    }

    if (typeof this.connectorRuntimeManager.runCycle === 'function') {
      return this.connectorRuntimeManager.runCycle();
    }

    if (
      this.connectorRuntimeManager.runtime &&
      typeof this.connectorRuntimeManager.runtime.loadAllConnectors === 'function'
    ) {
      return this.connectorRuntimeManager.runtime.loadAllConnectors();
    }

    return {
      ok: false,
      service: this.service,
      status: 'CONNECTOR_RUNTIME_REFRESH_METHOD_UNAVAILABLE'
    };
  }

  addDeploymentRegistryEntry(deployment) {
    const registry = this.readDeploymentRegistry();

    const filtered = registry.filter(
      (entry) => entry.capabilityId !== deployment.capabilityId
    );

    filtered.push(deployment);

    this.writeDeploymentRegistry(filtered);
  }

  isCapabilityAlreadyDeployed(capabilityId) {
    const registry = this.readDeploymentRegistry();

    return registry.some(
      (entry) =>
        entry.capabilityId === capabilityId &&
        entry.status === 'DEPLOYED'
    );
  }

  rollbackDeployment(deploymentId) {
    this.state.rollbacksAttempted += 1;
    this.state.lastRollbackAt = new Date().toISOString();

    try {
      const registry = this.readDeploymentRegistry();
      const deployment = registry.find((entry) => entry.deploymentId === deploymentId);

      if (!deployment) {
        throw new Error(`Deployment not found: ${deploymentId}`);
      }

      if (!deployment.previousWorkerPath) {
        throw new Error(`No previous worker backup exists for deployment: ${deploymentId}`);
      }

      if (!fs.existsSync(deployment.previousWorkerPath)) {
        throw new Error(`Backup file missing: ${deployment.previousWorkerPath}`);
      }

      fs.copyFileSync(deployment.previousWorkerPath, deployment.workerPath);

      const updatedRegistry = registry.map((entry) => {
        if (entry.deploymentId === deploymentId) {
          return {
            ...entry,
            status: 'ROLLED_BACK',
            rolledBackAt: new Date().toISOString()
          };
        }

        return entry;
      });

      this.writeDeploymentRegistry(updatedRegistry);

      const rollback = {
        deploymentId,
        capabilityId: deployment.capabilityId,
        workerId: deployment.workerId,
        restoredFrom: deployment.previousWorkerPath,
        restoredTo: deployment.workerPath,
        rolledBackAt: new Date().toISOString()
      };

      this.state.rollbacksCompleted += 1;
      this.state.status = 'DEPLOYMENT_ROLLED_BACK';
      this.state.lastRollback = rollback;
      this.state.lastError = null;

      this.appendJsonLine(this.rollbackLogPath, rollback);
      this.persistState();

      this.refreshWorkerRuntime();

      this.recordLearningEvent({
        eventType: 'OPERATION_OUTCOME',
        target: deployment.workerId,
        ok: true,
        status: 'DEPLOYMENT_ROLLED_BACK',
        raw: rollback
      });

      return {
        ok: true,
        service: this.service,
        status: 'DEPLOYMENT_ROLLED_BACK',
        rollback,
        state: this.getState()
      };
    } catch (error) {
      this.state.status = 'DEPLOYMENT_ROLLBACK_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      const failure = {
        deploymentId,
        error: error.message,
        failedAt: new Date().toISOString()
      };

      this.appendJsonLine(this.rollbackLogPath, failure);

      return {
        ok: false,
        service: this.service,
        status: 'DEPLOYMENT_ROLLBACK_FAILED',
        deploymentId,
        error: error.message,
        state: this.getState()
      };
    }
  }

  recordLearningEvent(event = {}) {
    if (!this.learningEngineManager) {
      return {
        ok: false,
        service: this.service,
        status: 'LEARNING_ENGINE_MANAGER_UNAVAILABLE'
      };
    }

    if (typeof this.learningEngineManager.recordEvent === 'function') {
      return this.learningEngineManager.recordEvent(event);
    }

    if (typeof this.learningEngineManager.recordOperationOutcome === 'function') {
      return this.learningEngineManager.recordOperationOutcome(event);
    }

    return {
      ok: false,
      service: this.service,
      status: 'LEARNING_RECORD_METHOD_UNAVAILABLE'
    };
  }

  updateExecutiveIntelligence(deployment) {
    if (!this.executiveIntelligence) {
      return {
        ok: false,
        service: this.service,
        status: 'EXECUTIVE_INTELLIGENCE_UNAVAILABLE'
      };
    }

    if (typeof this.executiveIntelligence.recordEvent === 'function') {
      return this.executiveIntelligence.recordEvent({
        eventType: 'CAPABILITY_DEPLOYMENT',
        deployment
      });
    }

    if (typeof this.executiveIntelligence.update === 'function') {
      return this.executiveIntelligence.update({
        capabilityDeployment: deployment
      });
    }

    return {
      ok: false,
      service: this.service,
      status: 'EXECUTIVE_INTELLIGENCE_UPDATE_METHOD_UNAVAILABLE'
    };
  }

  listDeployments() {
    const registry = this.readDeploymentRegistry();

    return {
      ok: true,
      service: this.service,
      status: 'DEPLOYMENTS_LISTED',
      deployments: registry
    };
  }

  async healthCheck() {
    const deploymentDirExists = fs.existsSync(this.deploymentDir);
    const capabilityDirExists = fs.existsSync(this.capabilityDir);
    const workerDirExists = fs.existsSync(this.workerDir);
    const statePathExists = fs.existsSync(this.statePath);
    const registryExists = fs.existsSync(this.deploymentRegistryPath);
    const deploymentLogExists = fs.existsSync(this.deploymentLogPath);
    const failedLogExists = fs.existsSync(this.failedDeploymentLogPath);
    const rollbackLogExists = fs.existsSync(this.rollbackLogPath);

    const ok =
      deploymentDirExists &&
      capabilityDirExists &&
      workerDirExists &&
      statePathExists &&
      registryExists &&
      deploymentLogExists &&
      failedLogExists &&
      rollbackLogExists;

    return {
      ok,
      service: this.service,
      version: this.version,
      status: ok ? 'HEALTHY' : 'DEGRADED',
      paths: {
        deploymentDir: this.deploymentDir,
        capabilityDir: this.capabilityDir,
        workerDir: this.workerDir,
        statePath: this.statePath,
        deploymentRegistryPath: this.deploymentRegistryPath,
        deploymentLogPath: this.deploymentLogPath,
        failedDeploymentLogPath: this.failedDeploymentLogPath,
        rollbackLogPath: this.rollbackLogPath
      },
      storage: {
        deploymentDirExists,
        capabilityDirExists,
        workerDirExists,
        statePathExists,
        registryExists,
        deploymentLogExists,
        failedLogExists,
        rollbackLogExists
      },
      state: this.getState()
    };
  }

  getState() {
    const registry = this.readDeploymentRegistry();

    return {
      ...this.state,
      registryEntries: registry.length,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = CapabilityDeploymentEngine;