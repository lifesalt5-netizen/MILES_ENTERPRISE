'use strict';

const fs = require('fs');
const path = require('path');

const InstantlyCOOWorker =
  require('../workers/InstantlyCOOWorker');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function now() {
  return new Date().toISOString();
}

function safeRequire(candidates) {
  for (const candidate of candidates) {
    try {
      return {
        ok: true,
        module: require(candidate),
        path: candidate
      };
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') {
        return {
          ok: false,
          error: error.message,
          path: candidate
        };
      }
    }
  }

  return {
    ok: false,
    error: 'MODULE_NOT_FOUND',
    path: candidates.join(' | ')
  };
}

function resolveExport(loaded, preferredNames = []) {
  if (!loaded || !loaded.ok) {
    return null;
  }

  const mod = loaded.module;

  if (typeof mod === 'function') {
    return mod;
  }

  if (mod && typeof mod.default === 'function') {
    return mod.default;
  }

  for (const name of preferredNames) {
    if (mod && typeof mod[name] === 'function') {
      return mod[name];
    }
  }

  return null;
}

function makeComponent(
  label,
  LoadedClass,
  args,
  bootReport
) {
  if (!LoadedClass) {
    bootReport.unavailable.push(label);
    return null;
  }

  try {
    const instance =
      new LoadedClass(args || {});

    bootReport.loaded.push(label);

    return instance;
  } catch (error) {
    bootReport.failed.push({
      component: label,
      error: error.message
    });

    return null;
  }
}

class DigitalCOOHost {
  constructor(options = {}) {
    this.service = 'DIGITAL_COO_HOST';
    this.version = '1.4.0';

    this.rootDir =
      options.rootDir ||
      process.env.MILES_ROOT ||
      path.resolve(__dirname, '..', '..');

    this.stateDir =
      path.join(
        this.rootDir,
        'state'
      );

    this.logsDir =
      path.join(
        this.rootDir,
        'logs'
      );

    this.executiveDir =
      path.join(
        this.rootDir,
        'executive_intelligence'
      );

    this.learningDir =
      path.join(
        this.rootDir,
        'learning'
      );

    this.recoveryDir =
      path.join(
        this.rootDir,
        'recovery'
      );

    [
      this.stateDir,
      this.logsDir,
      this.executiveDir,
      this.learningDir,
      this.recoveryDir
    ].forEach(ensureDir);

    this.logFile =
      path.join(
        this.logsDir,
        'digital_coo_host.log'
      );

    this.stateFile =
      path.join(
        this.stateDir,
        'digital_coo_host_state.json'
      );

    this.bootReportFile =
      path.join(
        this.stateDir,
        'digital_coo_boot_report.json'
      );

    this.operationQueueFile =
      path.join(
        this.stateDir,
        'digital_coo_host_operation_queue.json'
      );

    this.bootReport = {
      generatedAt: now(),
      loaded: [],
      unavailable: [],
      failed: []
    };

    const WorkerRegistry =
      resolveExport(
        safeRequire([
          '../worker_runtime/WorkerRegistry',
          '../WorkerRegistry'
        ]),
        [
          'WorkerRegistry'
        ]
      );

    const WorkerDispatcher =
      resolveExport(
        safeRequire([
          '../worker_runtime/WorkerDispatcher',
          '../WorkerDispatcher'
        ]),
        [
          'WorkerDispatcher'
        ]
      );

    const WorkerRuntime =
      resolveExport(
        safeRequire([
          '../worker_runtime/WorkerRuntime',
          '../WorkerRuntime'
        ]),
        [
          'WorkerRuntime'
        ]
      );

    const WorkerRuntimeManager =
      resolveExport(
        safeRequire([
          '../worker_runtime/WorkerRuntimeManager',
          '../WorkerRuntimeManager'
        ]),
        [
          'WorkerRuntimeManager'
        ]
      );

    const ConnectorRuntime =
      resolveExport(
        safeRequire([
          '../connector_runtime/ConnectorRuntime',
          '../ConnectorRuntime'
        ]),
        [
          'ConnectorRuntime'
        ]
      );

    const ConnectorRuntimeManager =
      resolveExport(
        safeRequire([
          '../connector_runtime/ConnectorRuntimeManager',
          '../ConnectorRuntimeManager'
        ]),
        [
          'ConnectorRuntimeManager'
        ]
      );

    const LearningEngine =
      resolveExport(
        safeRequire([
          '../learning_engine/LearningEngine',
          '../LearningEngine'
        ]),
        [
          'LearningEngine'
        ]
      );

    const LearningEngineManager =
      resolveExport(
        safeRequire([
          '../learning_engine/LearningEngineManager',
          '../LearningEngineManager'
        ]),
        [
          'LearningEngineManager'
        ]
      );

    const DigitalCOORuntime =
      resolveExport(
        safeRequire([
          './DigitalCOORuntime'
        ]),
        [
          'DigitalCOORuntime'
        ]
      );

    const DigitalCOORuntimeManager =
      resolveExport(
        safeRequire([
          './DigitalCOORuntimeManager'
        ]),
        [
          'DigitalCOORuntimeManager'
        ]
      );

    const COOBusinessStateEngine =
      resolveExport(
        safeRequire([
          './COOBusinessStateEngine'
        ]),
        [
          'COOBusinessStateEngine'
        ]
      );

    const COOGoalEngine =
      resolveExport(
        safeRequire([
          './COOGoalEngine'
        ]),
        [
          'COOGoalEngine'
        ]
      );

    const COOExecutionLoop =
      resolveExport(
        safeRequire([
          './COOExecutionLoop'
        ]),
        [
          'COOExecutionLoop'
        ]
      );

    this.workerRegistry =
      options.workerRegistry ||
      makeComponent(
        'workerRegistry',
        WorkerRegistry,
        {
          rootDir: this.rootDir
        },
        this.bootReport
      );

    this.workerDispatcher =
      options.workerDispatcher ||
      makeComponent(
        'workerDispatcher',
        WorkerDispatcher,
        {
          rootDir: this.rootDir,
          registry: this.workerRegistry
        },
        this.bootReport
      );

    this.workerRuntime =
      options.workerRuntime ||
      makeComponent(
        'workerRuntime',
        WorkerRuntime,
        {
          rootDir: this.rootDir,
          registry: this.workerRegistry,
          dispatcher: this.workerDispatcher
        },
        this.bootReport
      );

    this.workerRuntimeManager =
      options.workerRuntimeManager ||
      makeComponent(
        'workerRuntimeManager',
        WorkerRuntimeManager,
        {
          rootDir: this.rootDir,
          registry: this.workerRegistry,
          dispatcher: this.workerDispatcher,
          runtime: this.workerRuntime
        },
        this.bootReport
      );

    this.registerOperationalWorkers();

    this.connectorRuntime =
      options.connectorRuntime ||
      makeComponent(
        'connectorRuntime',
        ConnectorRuntime,
        {
          rootDir: this.rootDir
        },
        this.bootReport
      );

    this.connectorRuntimeManager =
      options.connectorRuntimeManager ||
      makeComponent(
        'connectorRuntimeManager',
        ConnectorRuntimeManager,
        {
          rootDir: this.rootDir,
          runtime: this.connectorRuntime
        },
        this.bootReport
      );

    this.learningEngine =
      options.learningEngine ||
      makeComponent(
        'learningEngine',
        LearningEngine,
        {
          rootDir: this.rootDir
        },
        this.bootReport
      );

    this.learningEngineManager =
      options.learningEngineManager ||
      makeComponent(
        'learningEngineManager',
        LearningEngineManager,
        {
          rootDir: this.rootDir,
          learningEngine: this.learningEngine
        },
        this.bootReport
      );

    this.digitalCOORuntime =
      options.digitalCOORuntime ||
      makeComponent(
        'digitalCOORuntime',
        DigitalCOORuntime,
        {
          rootDir: this.rootDir,
          workerRuntimeManager:
            this.workerRuntimeManager,
          connectorRuntimeManager:
            this.connectorRuntimeManager,
          learningEngineManager:
            this.learningEngineManager
        },
        this.bootReport
      );

    this.digitalCOORuntimeManager =
      options.digitalCOORuntimeManager ||
      makeComponent(
        'digitalCOORuntimeManager',
        DigitalCOORuntimeManager,
        {
          rootDir: this.rootDir,
          runtime: this.digitalCOORuntime
        },
        this.bootReport
      );

    this.cooBusinessStateEngine =
      options.cooBusinessStateEngine ||
      makeComponent(
        'cooBusinessStateEngine',
        COOBusinessStateEngine,
        {
          rootDir: this.rootDir
        },
        this.bootReport
      );

    this.cooGoalEngine =
      options.cooGoalEngine ||
      makeComponent(
        'cooGoalEngine',
        COOGoalEngine,
        {
          rootDir: this.rootDir,
          businessStateEngine:
            this.cooBusinessStateEngine
        },
        this.bootReport
      );

    this.cooExecutionLoop =
      options.cooExecutionLoop ||
      makeComponent(
        'cooExecutionLoop',
        COOExecutionLoop,
        {
          rootDir: this.rootDir,
          digitalCOOHost: this,
          goalEngine:
            this.cooGoalEngine,
          businessStateEngine:
            this.cooBusinessStateEngine,
          intervalMs:
            options.intervalMs || 60000
        },
        this.bootReport
      );

    this.running = false;

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      rootDir: this.rootDir,
      running: false,
      startedAt: null,
      stoppedAt: null,
      startCount: 0,
      stopCount: 0,
      healthChecks: 0,
      operationsAccepted: 0,
      operationsDispatched: 0,
      operationsFailed: 0,
      operationsWaitingApproval: 0,
      lastHealthAt: null,
      lastOperationAt: null,
      lastOperationId: null,
      lastDispatchStatus: null,
      lastError: null,
      generatedAt: now()
    };

    this.writeJson(
      this.bootReportFile,
      this.bootReport
    );

    this.saveState();
  }

  registerOperationalWorkers() {
    if (
      !this.workerRegistry ||
      typeof this.workerRegistry.register !== 'function'
    ) {
      this.bootReport.failed.push({
        component:
          'InstantlyCOOWorker:revenueWorker',
        error:
          'Worker registry is unavailable.'
      });

      return;
    }

    try {
      const instantlyCOOWorker =
        new InstantlyCOOWorker({
          rootDir: this.rootDir
        });

      const aliases = [
        'revenueWorker',
        'InstantlyCOOWorker',
        'INSTANTLY_COO_WORKER'
      ];

      for (const alias of aliases) {
        this.workerRegistry.register(
          alias,
          instantlyCOOWorker
        );
      }

      this.instantlyCOOWorker =
        instantlyCOOWorker;

      this.bootReport.loaded.push(
        'InstantlyCOOWorker:revenueWorker'
      );
    } catch (error) {
      this.bootReport.failed.push({
        component:
          'InstantlyCOOWorker:revenueWorker',
        error:
          error.message
      });

      this.log(
        'ERROR',
        `Instantly COO worker registration failed: ${error.message}`
      );
    }
  }

  async start() {
    const results = [];

    if (this.running) {
      return {
        ok: true,
        service: this.service,
        status: 'ALREADY_RUNNING',
        state: this.getState()
      };
    }

    results.push(
      await this.safeStart(
        'connectorRuntimeManager',
        this.connectorRuntimeManager
      )
    );

    results.push(
      await this.safeStart(
        'learningEngineManager',
        this.learningEngineManager
      )
    );

    results.push(
      await this.safeStart(
        'workerRuntimeManager',
        this.workerRuntimeManager
      )
    );

    results.push(
      await this.safeStart(
        'digitalCOORuntimeManager',
        this.digitalCOORuntimeManager
      )
    );

    results.push(
      await this.safeStart(
        'cooBusinessStateEngine',
        this.cooBusinessStateEngine
      )
    );

    results.push(
      await this.safeStart(
        'cooGoalEngine',
        this.cooGoalEngine
      )
    );

    this.running = true;
    this.state.running = true;
    this.state.startedAt = now();
    this.state.stoppedAt = null;
    this.state.startCount += 1;

    results.push(
      await this.safeStart(
        'cooExecutionLoop',
        this.cooExecutionLoop
      )
    );

    this.state.ok = true;
    this.state.status = 'RUNNING';
    this.state.lastError = null;

    this.saveState();

    this.log(
      'INFO',
      'Miles Digital COO Host started.'
    );

    return {
      ok: true,
      service: this.service,
      status: 'RUNNING',
      results,
      bootReport: this.bootReport,
      workers:
        this.workerRegistry &&
        typeof this.workerRegistry.listWorkers ===
          'function'
          ? this.workerRegistry.listWorkers()
          : [],
      state: this.getState()
    };
  }

  async stop() {
    const results = [];

    results.push(
      await this.safeStop(
        'cooExecutionLoop',
        this.cooExecutionLoop
      )
    );

    results.push(
      await this.safeStop(
        'cooGoalEngine',
        this.cooGoalEngine
      )
    );

    results.push(
      await this.safeStop(
        'cooBusinessStateEngine',
        this.cooBusinessStateEngine
      )
    );

    results.push(
      await this.safeStop(
        'digitalCOORuntimeManager',
        this.digitalCOORuntimeManager
      )
    );

    results.push(
      await this.safeStop(
        'workerRuntimeManager',
        this.workerRuntimeManager
      )
    );

    results.push(
      await this.safeStop(
        'learningEngineManager',
        this.learningEngineManager
      )
    );

    results.push(
      await this.safeStop(
        'connectorRuntimeManager',
        this.connectorRuntimeManager
      )
    );

    this.running = false;
    this.state.running = false;
    this.state.status = 'STOPPED';
    this.state.stoppedAt = now();
    this.state.stopCount += 1;

    this.saveState();

    this.log(
      'INFO',
      'Miles Digital COO Host stopped.'
    );

    return {
      ok: true,
      service: this.service,
      status: 'STOPPED',
      results,
      state: this.getState()
    };
  }

  async safeStart(name, component) {
    if (
      !component ||
      typeof component.start !== 'function'
    ) {
      return {
        ok: true,
        component: name,
        status: 'START_SKIPPED'
      };
    }

    try {
      const result =
        await component.start();

      return {
        ok:
          result &&
          result.ok === false
            ? false
            : true,
        component: name,
        ...(result || {})
      };
    } catch (error) {
      this.log(
        'ERROR',
        `${name} start failed: ${error.message}`
      );

      return {
        ok: false,
        component: name,
        status: 'START_FAILED',
        error: error.message
      };
    }
  }

  async safeStop(name, component) {
    if (
      !component ||
      typeof component.stop !== 'function'
    ) {
      return {
        ok: true,
        component: name,
        status: 'STOP_SKIPPED'
      };
    }

    try {
      const result =
        await component.stop();

      return {
        ok:
          result &&
          result.ok === false
            ? false
            : true,
        component: name,
        ...(result || {})
      };
    } catch (error) {
      this.log(
        'ERROR',
        `${name} stop failed: ${error.message}`
      );

      return {
        ok: false,
        component: name,
        status: 'STOP_FAILED',
        error: error.message
      };
    }
  }

  async healthCheck() {
    const components = {
      connectorRuntimeManager:
        await this.safeHealth(
          this.connectorRuntimeManager
        ),

      learningEngineManager:
        await this.safeHealth(
          this.learningEngineManager
        ),

      workerRuntimeManager:
        await this.safeHealth(
          this.workerRuntimeManager
        ),

      workerRegistry:
        await this.safeHealth(
          this.workerRegistry
        ),

      workerDispatcher:
        await this.safeHealth(
          this.workerDispatcher
        ),

      instantlyCOOWorker:
        await this.safeHealth(
          this.instantlyCOOWorker
        ),

      digitalCOORuntimeManager:
        await this.safeHealth(
          this.digitalCOORuntimeManager
        ),

      cooBusinessStateEngine:
        await this.safeHealth(
          this.cooBusinessStateEngine
        ),

      cooGoalEngine:
        await this.safeHealth(
          this.cooGoalEngine
        ),

      cooExecutionLoop:
        await this.safeHealth(
          this.cooExecutionLoop
        )
    };

    const componentResults =
      Object.values(components);

    const healthy =
      componentResults.every(
        (component) =>
          !component ||
          component.ok !== false
      );

    const health = {
      ok: healthy,
      service: this.service,
      version: this.version,
      status:
        healthy
          ? 'HEALTHY'
          : 'DEGRADED',
      running: this.running,
      components,
      workers:
        this.workerRegistry &&
        typeof this.workerRegistry.listWorkers ===
          'function'
          ? this.workerRegistry.listWorkers()
          : [],
      bootReport: this.bootReport,
      state: this.getState(),
      generatedAt: now()
    };

    this.state.ok = healthy;
    this.state.status =
      healthy
        ? (
            this.running
              ? 'RUNNING'
              : 'INITIALIZED'
          )
        : 'DEGRADED';

    this.state.healthChecks += 1;
    this.state.lastHealthAt =
      health.generatedAt;

    this.saveState();

    return health;
  }

  async safeHealth(component) {
    if (!component) {
      return {
        ok: true,
        status: 'UNAVAILABLE_SKIPPED'
      };
    }

    try {
      if (
        typeof component.healthCheck ===
        'function'
      ) {
        return await component.healthCheck();
      }

      if (
        typeof component.getState ===
        'function'
      ) {
        return {
          ok: true,
          status: 'STATE_AVAILABLE',
          state: component.getState()
        };
      }

      return {
        ok: true,
        status: 'NO_HEALTH_INTERFACE'
      };
    } catch (error) {
      return {
        ok: false,
        status: 'HEALTH_FAILED',
        error: error.message
      };
    }
  }

  async enqueueOperation(operation = {}) {
    const normalizedOperation = {
      ...operation,
      id:
        operation.id ||
        `op_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      status:
        operation.status ||
        'READY',
      createdAt:
        operation.createdAt ||
        now(),
      updatedAt:
        now()
    };

    const record = {
      ok: true,
      service: this.service,
      status:
        'OPERATION_ACCEPTED_BY_HOST',
      operation: normalizedOperation,
      dispatch: null,
      generatedAt: now()
    };

    const queue =
      this.readJson(
        this.operationQueueFile,
        {
          generatedAt: now(),
          source: this.service,
          operations: []
        }
      );

    queue.operations =
      Array.isArray(queue.operations)
        ? queue.operations
        : [];

    this.state.operationsAccepted += 1;
    this.state.lastOperationAt = now();
    this.state.lastOperationId =
      normalizedOperation.id;

    const requiresApproval =
      Boolean(
        normalizedOperation.approvalRequired ||
        normalizedOperation.ceoEscalationOnly ||
        normalizedOperation.status ===
          'WAITING_FOR_CEO_APPROVAL'
      );

    if (requiresApproval) {
      normalizedOperation.status =
        'WAITING_FOR_CEO_APPROVAL';

      normalizedOperation.updatedAt =
        now();

      record.status =
        'WAITING_FOR_CEO_APPROVAL';

      this.state.operationsWaitingApproval += 1;
      this.state.lastDispatchStatus =
        record.status;

      queue.operations.unshift(record);
      queue.generatedAt = now();

      this.writeJson(
        this.operationQueueFile,
        queue
      );

      this.saveState();

      this.log(
        'INFO',
        `Operation ${normalizedOperation.id} is waiting for CEO approval.`
      );

      return record;
    }

    if (
      !this.workerDispatcher ||
      typeof this.workerDispatcher.dispatch !==
        'function'
    ) {
      record.ok = false;
      record.status =
        'WORKER_DISPATCHER_UNAVAILABLE';

      this.state.operationsFailed += 1;
      this.state.lastDispatchStatus =
        record.status;
      this.state.lastError =
        'Worker dispatcher unavailable.';

      queue.operations.unshift(record);
      queue.generatedAt = now();

      this.writeJson(
        this.operationQueueFile,
        queue
      );

      this.saveState();

      this.log(
        'ERROR',
        `Operation ${normalizedOperation.id} could not dispatch because WorkerDispatcher is unavailable.`
      );

      return record;
    }

    try {
      normalizedOperation.status =
        'DISPATCHING';

      normalizedOperation.updatedAt =
        now();

      const dispatchResult =
        await this.workerDispatcher.dispatch(
          normalizedOperation
        );

      record.dispatch =
        dispatchResult;

      record.ok =
        Boolean(
          dispatchResult &&
          dispatchResult.ok
        );

      record.status =
        record.ok
          ? 'OPERATION_DISPATCHED'
          : 'OPERATION_DISPATCH_FAILED';

      normalizedOperation.status =
        record.status;

      normalizedOperation.updatedAt =
        now();

      this.state.lastDispatchStatus =
        record.status;

      if (record.ok) {
        this.state.operationsDispatched += 1;
        this.state.lastError = null;
      } else {
        this.state.operationsFailed += 1;
        this.state.lastError =
          dispatchResult &&
          (
            dispatchResult.reason ||
            dispatchResult.error
          )
            ? (
                dispatchResult.reason ||
                dispatchResult.error
              )
            : 'Operation dispatch failed.';
      }
    } catch (error) {
      record.ok = false;
      record.status =
        'OPERATION_DISPATCH_ERROR';

      record.dispatch = {
        ok: false,
        service:
          'WORKER_DISPATCHER',
        status:
          'DISPATCH_EXCEPTION',
        error:
          error.message,
        generatedAt:
          now()
      };

      normalizedOperation.status =
        record.status;

      normalizedOperation.updatedAt =
        now();

      this.state.operationsFailed += 1;
      this.state.lastDispatchStatus =
        record.status;
      this.state.lastError =
        error.message;

      this.log(
        'ERROR',
        `Operation ${normalizedOperation.id} dispatch failed: ${error.message}`
      );
    }

    queue.operations.unshift(record);
    queue.generatedAt = now();

    this.writeJson(
      this.operationQueueFile,
      queue
    );

    this.saveState();

    return record;
  }

  async runCOOCycle() {
    if (
      this.cooExecutionLoop &&
      typeof this.cooExecutionLoop.runCycle ===
        'function'
    ) {
      return await this.cooExecutionLoop.runCycle();
    }

    return {
      ok: false,
      service: this.service,
      status:
        'COO_EXECUTION_LOOP_UNAVAILABLE'
    };
  }

  getExecutiveSummary() {
    return {
      ok: true,
      service: this.service,
      status:
        'DIGITAL_COO_HOST_SUMMARY_READY',
      running: this.running,
      businessState:
        this.callSummary(
          this.cooBusinessStateEngine
        ),
      goals:
        this.callSummary(
          this.cooGoalEngine
        ),
      execution:
        this.callSummary(
          this.cooExecutionLoop
        ),
      workers:
        this.workerRegistry &&
        typeof this.workerRegistry.listWorkers ===
          'function'
          ? this.workerRegistry.listWorkers()
          : [],
      dispatcher:
        this.callSummary(
          this.workerDispatcher
        ),
      instantlyCOOWorker:
        this.callSummary(
          this.instantlyCOOWorker
        ),
      bootReport:
        this.bootReport,
      state:
        this.getState(),
      generatedAt:
        now()
    };
  }

  callSummary(component) {
    try {
      if (
        component &&
        typeof component.getExecutiveSummary ===
          'function'
      ) {
        return component.getExecutiveSummary();
      }

      if (
        component &&
        typeof component.getState ===
          'function'
      ) {
        return component.getState();
      }

      return null;
    } catch (error) {
      return {
        ok: false,
        error: error.message
      };
    }
  }

  getState() {
    return {
      ...this.state,
      running: this.running,
      generatedAt: now()
    };
  }

  saveState() {
    this.writeJson(
      this.stateFile,
      this.getState()
    );
  }

  readJson(file, fallback) {
    try {
      if (!fs.existsSync(file)) {
        return fallback;
      }

      return JSON.parse(
        fs.readFileSync(
          file,
          'utf8'
        )
      );
    } catch {
      return fallback;
    }
  }

  writeJson(file, data) {
    ensureDir(
      path.dirname(file)
    );

    fs.writeFileSync(
      file,
      JSON.stringify(
        data,
        null,
        2
      ),
      'utf8'
    );
  }

  log(level, message, metadata = {}) {
    ensureDir(
      path.dirname(this.logFile)
    );

    fs.appendFileSync(
      this.logFile,
      JSON.stringify({
        timestamp: now(),
        level,
        service: this.service,
        message,
        metadata
      }) + '\n',
      'utf8'
    );
  }
}

module.exports =
  DigitalCOOHost;

module.exports.DigitalCOOHost =
  DigitalCOOHost;

module.exports.default =
  DigitalCOOHost;

if (require.main === module) {
  require('dotenv').config();

  process.env.MILES_ROOT =
    process.env.MILES_ROOT ||
    path.resolve(
      __dirname,
      '..',
      '..'
    );

  const host =
    new DigitalCOOHost({
      rootDir:
        process.env.MILES_ROOT
    });

  host.start()
    .then((result) => {
      console.log(
        JSON.stringify(
          result,
          null,
          2
        )
      );

      console.log(
        'Miles Digital COO is running. Press Ctrl+C to stop.'
      );
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });

  process.on(
    'SIGINT',
    async () => {
      console.log(
        '\nStopping Miles Digital COO...'
      );

      const result =
        await host.stop();

      console.log(
        JSON.stringify(
          result,
          null,
          2
        )
      );

      process.exit(0);
    }
  );
}