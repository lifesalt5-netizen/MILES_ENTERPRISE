'use strict';

/*
  MILES Enterprise
  File: SERVICES/connector_runtime/ConnectorRuntime.js
  Version: 1.1.0

  Complete replacement.

  Fixes:
  - Discovers connector.js inside connector directories.
  - Preserves support for index.js and directory-named connector files.
  - Supports case-insensitive connector IDs.
  - Passes connectorAction and method to connector adapters.
  - Prevents duplicate connector definitions.
  - Records skipped connector directories.
  - Clears previous runtime state when discovery runs.
  - Supports health checks, dynamic loading, execution logging, and auto-loading.
*/

const fs = require('fs');
const path = require('path');

class ConnectorRuntime {
  constructor(options = {}) {
    this.service = 'CONNECTOR_RUNTIME';
    this.version = '1.1.0';

    this.rootDir = path.resolve(
      options.rootDir ||
      process.env.MILES_ROOT ||
      process.cwd()
    );

    this.connectorDir = path.resolve(
      options.connectorDir ||
      path.join(this.rootDir, 'CONNECTORS')
    );

    this.runtimeDir = path.resolve(
      options.runtimeDir ||
      path.join(this.rootDir, 'runtime')
    );

    this.statePath = path.resolve(
      options.statePath ||
      path.join(
        this.runtimeDir,
        'connector_runtime_state.json'
      )
    );

    this.executionLogPath = path.resolve(
      options.executionLogPath ||
      path.join(
        this.runtimeDir,
        'connector_execution_log.jsonl'
      )
    );

    this.connectors = new Map();

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      generatedAt: this.now(),
      connectorDir: this.connectorDir,
      connectorsDiscovered: 0,
      connectorsLoaded: 0,
      connectorsFailed: 0,
      connectorsSkipped: 0,
      discoveredConnectors: [],
      skippedConnectors: [],
      loadedConnectors: [],
      executionsStarted: 0,
      executionsCompleted: 0,
      executionsFailed: 0,
      lastDiscoveryAt: null,
      lastLoadAt: null,
      lastExecutionAt: null,
      lastError: null
    };

    this.ensureRuntimeStorage();
  }

  now() {
    return new Date().toISOString();
  }

  normalizeConnectorId(value) {
    return String(value || '')
      .trim()
      .replace(/[^A-Za-z0-9_.:-]+/g, '_')
      .toUpperCase();
  }

  ensureDirectory(directoryPath) {
    fs.mkdirSync(
      directoryPath,
      {
        recursive: true
      }
    );
  }

  ensureRuntimeStorage() {
    this.ensureDirectory(
      this.runtimeDir
    );

    this.ensureDirectory(
      this.connectorDir
    );

    if (!fs.existsSync(this.executionLogPath)) {
      fs.writeFileSync(
        this.executionLogPath,
        '',
        'utf8'
      );
    }

    this.persistState();
  }

  atomicWriteJson(filePath, value) {
    this.ensureDirectory(
      path.dirname(filePath)
    );

    const temporaryPath =
      `${filePath}.${process.pid}.${Date.now()}.tmp`;

    const serialized =
      JSON.stringify(
        value,
        null,
        2
      );

    try {
      fs.writeFileSync(
        temporaryPath,
        serialized,
        'utf8'
      );

      fs.renameSync(
        temporaryPath,
        filePath
      );
    } catch {
      try {
        fs.writeFileSync(
          filePath,
          serialized,
          'utf8'
        );
      } finally {
        try {
          if (fs.existsSync(temporaryPath)) {
            fs.unlinkSync(temporaryPath);
          }
        } catch {}
      }
    }
  }

  persistState() {
    this.state.generatedAt =
      this.now();

    this.atomicWriteJson(
      this.statePath,
      this.getState()
    );
  }

  appendExecutionLog(entry) {
    const payload = {
      ...entry,
      loggedAt: this.now()
    };

    fs.appendFileSync(
      this.executionLogPath,
      `${JSON.stringify(payload)}\n`,
      'utf8'
    );
  }

  resolveDirectoryConnector(entry) {
    const directoryPath =
      path.join(
        this.connectorDir,
        entry.name
      );

    const candidates = [
      {
        connectorPath:
          path.join(
            directoryPath,
            'index.js'
          ),
        type:
          'DIRECTORY_INDEX'
      },
      {
        connectorPath:
          path.join(
            directoryPath,
            'connector.js'
          ),
        type:
          'DIRECTORY_CONNECTOR'
      },
      {
        connectorPath:
          path.join(
            directoryPath,
            `${entry.name}.js`
          ),
        type:
          'DIRECTORY_NAMED_FILE'
      },
      {
        connectorPath:
          path.join(
            directoryPath,
            `${entry.name.toLowerCase()}.js`
          ),
        type:
          'DIRECTORY_NAMED_FILE_LOWERCASE'
      }
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate.connectorPath)) {
        return {
          connectorId:
            this.normalizeConnectorId(
              entry.name
            ),
          connectorName:
            entry.name,
          connectorPath:
            candidate.connectorPath,
          type:
            candidate.type,
          status:
            'DISCOVERED'
        };
      }
    }

    return null;
  }

  discoverConnectors() {
    try {
      const discoveredMap =
        new Map();

      const skipped = [];

      if (!fs.existsSync(this.connectorDir)) {
        this.ensureDirectory(
          this.connectorDir
        );
      }

      const entries =
        fs.readdirSync(
          this.connectorDir,
          {
            withFileTypes: true
          }
        );

      for (const entry of entries) {
        if (
          entry.name.startsWith('.') ||
          entry.name.startsWith('_')
        ) {
          skipped.push({
            name:
              entry.name,
            reason:
              'HIDDEN_OR_REFERENCE_DIRECTORY'
          });

          continue;
        }

        if (
          entry.isFile() &&
          entry.name.toLowerCase().endsWith('.js')
        ) {
          const connectorId =
            this.normalizeConnectorId(
              path.basename(
                entry.name,
                path.extname(entry.name)
              )
            );

          const definition = {
            connectorId,
            connectorName:
              path.basename(
                entry.name,
                path.extname(entry.name)
              ),
            connectorPath:
              path.join(
                this.connectorDir,
                entry.name
              ),
            type:
              'ROOT_FILE',
            status:
              'DISCOVERED'
          };

          discoveredMap.set(
            connectorId,
            definition
          );

          continue;
        }

        if (entry.isDirectory()) {
          const definition =
            this.resolveDirectoryConnector(
              entry
            );

          if (definition) {
            discoveredMap.set(
              definition.connectorId,
              definition
            );
          } else {
            skipped.push({
              name:
                entry.name,
              directory:
                path.join(
                  this.connectorDir,
                  entry.name
                ),
              reason:
                'NO_SUPPORTED_CONNECTOR_ENTRYPOINT',
              searchedFor: [
                'index.js',
                'connector.js',
                `${entry.name}.js`,
                `${entry.name.toLowerCase()}.js`
              ]
            });
          }
        }
      }

      const discovered = [
        ...discoveredMap.values()
      ].sort(
        (left, right) =>
          left.connectorId.localeCompare(
            right.connectorId
          )
      );

      this.state.ok = true;
      this.state.status =
        'CONNECTORS_DISCOVERED';
      this.state.connectorsDiscovered =
        discovered.length;
      this.state.connectorsSkipped =
        skipped.length;
      this.state.discoveredConnectors =
        discovered.map(
          connector => ({
            connectorId:
              connector.connectorId,
            connectorName:
              connector.connectorName,
            connectorPath:
              connector.connectorPath,
            type:
              connector.type,
            status:
              connector.status
          })
        );
      this.state.skippedConnectors =
        skipped;
      this.state.lastDiscoveryAt =
        this.now();
      this.state.lastError =
        null;

      this.persistState();

      return {
        ok: true,
        service:
          this.service,
        version:
          this.version,
        status:
          'CONNECTORS_DISCOVERED',
        connectorDir:
          this.connectorDir,
        discovered:
          discovered.length,
        skipped:
          skipped.length,
        connectors:
          discovered,
        skippedConnectors:
          skipped,
        generatedAt:
          this.now()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status =
        'CONNECTOR_DISCOVERY_FAILED';
      this.state.lastError =
        error.stack ||
        error.message;

      this.persistState();

      return {
        ok: false,
        service:
          this.service,
        version:
          this.version,
        status:
          'CONNECTOR_DISCOVERY_FAILED',
        connectorDir:
          this.connectorDir,
        error:
          error.message,
        generatedAt:
          this.now()
      };
    }
  }

  loadConnector(connectorDefinition = {}) {
    const connectorId =
      this.normalizeConnectorId(
        connectorDefinition.connectorId ||
        connectorDefinition.id ||
        connectorDefinition.name
      );

    const connectorPath =
      connectorDefinition.connectorPath
        ? path.resolve(
            connectorDefinition.connectorPath
          )
        : null;

    if (!connectorId || !connectorPath) {
      return {
        ok: false,
        service:
          this.service,
        status:
          'CONNECTOR_ID_AND_PATH_REQUIRED'
      };
    }

    try {
      if (!fs.existsSync(connectorPath)) {
        throw new Error(
          `Connector file not found: ${connectorPath}`
        );
      }

      const resolvedPath =
        require.resolve(
          connectorPath
        );

      delete require.cache[
        resolvedPath
      ];

      const ConnectorModule =
        require(resolvedPath);

      let instance;

      if (
        typeof ConnectorModule ===
        'function'
      ) {
        instance =
          new ConnectorModule({
            rootDir:
              this.rootDir,
            connectorId
          });
      } else if (
        ConnectorModule &&
        typeof ConnectorModule.default ===
        'function'
      ) {
        instance =
          new ConnectorModule.default({
            rootDir:
              this.rootDir,
            connectorId
          });
      } else if (
        ConnectorModule &&
        ConnectorModule.default &&
        typeof ConnectorModule.default ===
        'object'
      ) {
        instance =
          ConnectorModule.default;
      } else {
        instance =
          ConnectorModule;
      }

      if (!instance) {
        throw new Error(
          `Connector module returned no usable instance: ${connectorPath}`
        );
      }

      this.connectors.set(
        connectorId,
        {
          connectorId,
          connectorName:
            connectorDefinition.connectorName ||
            connectorDefinition.name ||
            connectorId,
          connectorPath,
          connectorType:
            connectorDefinition.type ||
            'UNKNOWN',
          instance,
          loadedAt:
            this.now(),
          status:
            'LOADED'
        }
      );

      this.state.ok = true;
      this.state.status =
        'CONNECTOR_LOADED';
      this.state.connectorsLoaded =
        this.connectors.size;
      this.state.loadedConnectors = [
        ...this.connectors.keys()
      ];
      this.state.lastLoadAt =
        this.now();
      this.state.lastError =
        null;

      this.persistState();

      return {
        ok: true,
        service:
          this.service,
        status:
          'CONNECTOR_LOADED',
        connectorId,
        connectorPath
      };
    } catch (error) {
      this.state.connectorsFailed +=
        1;
      this.state.status =
        'CONNECTOR_LOAD_FAILED';
      this.state.lastError =
        error.stack ||
        error.message;

      this.persistState();

      return {
        ok: false,
        service:
          this.service,
        status:
          'CONNECTOR_LOAD_FAILED',
        connectorId,
        connectorPath,
        error:
          error.message
      };
    }
  }

  loadAllConnectors() {
    const discovery =
      this.discoverConnectors();

    if (!discovery.ok) {
      return discovery;
    }

    this.connectors.clear();

    const results = [];

    for (
      const connector
      of discovery.connectors
    ) {
      results.push(
        this.loadConnector(
          connector
        )
      );
    }

    const loaded =
      results.filter(
        result => result.ok
      ).length;

    const failed =
      results.filter(
        result => !result.ok
      ).length;

    this.state.ok =
      failed === 0;

    this.state.status =
      failed === 0
        ? 'ALL_CONNECTORS_LOADED'
        : 'CONNECTORS_LOADED_WITH_ERRORS';

    this.state.connectorsLoaded =
      this.connectors.size;

    this.state.connectorsFailed =
      failed;

    this.state.loadedConnectors = [
      ...this.connectors.keys()
    ];

    this.state.lastLoadAt =
      this.now();

    this.state.lastError =
      failed
        ? `${failed} connector(s) failed to load.`
        : null;

    this.persistState();

    return {
      ok:
        failed === 0,
      service:
        this.service,
      version:
        this.version,
      status:
        this.state.status,
      discovered:
        discovery.discovered,
      skipped:
        discovery.skipped,
      loaded,
      failed,
      loadedConnectors: [
        ...this.connectors.keys()
      ],
      results,
      skippedConnectors:
        discovery.skippedConnectors,
      generatedAt:
        this.now()
    };
  }

  unloadConnector(connectorId) {
    const normalizedId =
      this.normalizeConnectorId(
        connectorId
      );

    if (!normalizedId) {
      return {
        ok: false,
        service:
          this.service,
        status:
          'CONNECTOR_ID_REQUIRED'
      };
    }

    if (
      !this.connectors.has(
        normalizedId
      )
    ) {
      return {
        ok: false,
        service:
          this.service,
        status:
          'CONNECTOR_NOT_LOADED',
        connectorId:
          normalizedId
      };
    }

    this.connectors.delete(
      normalizedId
    );

    this.state.status =
      'CONNECTOR_UNLOADED';

    this.state.connectorsLoaded =
      this.connectors.size;

    this.state.loadedConnectors = [
      ...this.connectors.keys()
    ];

    this.persistState();

    return {
      ok: true,
      service:
        this.service,
      status:
        'CONNECTOR_UNLOADED',
      connectorId:
        normalizedId
    };
  }

  tryAutoLoadConnector(connectorId) {
    const normalizedId =
      this.normalizeConnectorId(
        connectorId
      );

    const entries =
      fs.existsSync(this.connectorDir)
        ? fs.readdirSync(
            this.connectorDir,
            {
              withFileTypes: true
            }
          )
        : [];

    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        this.normalizeConnectorId(
          entry.name
        ) === normalizedId
      ) {
        const definition =
          this.resolveDirectoryConnector(
            entry
          );

        if (definition) {
          return this.loadConnector(
            definition
          );
        }
      }

      if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith('.js') &&
        this.normalizeConnectorId(
          path.basename(
            entry.name,
            path.extname(entry.name)
          )
        ) === normalizedId
      ) {
        return this.loadConnector({
          connectorId:
            normalizedId,
          connectorName:
            path.basename(
              entry.name,
              path.extname(entry.name)
            ),
          connectorPath:
            path.join(
              this.connectorDir,
              entry.name
            ),
          type:
            'ROOT_FILE'
        });
      }
    }

    return {
      ok: false,
      service:
        this.service,
      status:
        'CONNECTOR_NOT_FOUND',
      connectorId:
        normalizedId,
      connectorDir:
        this.connectorDir
    };
  }

  async execute(request = {}) {
    const connectorId =
      this.normalizeConnectorId(
        request.connectorId ||
        request.connector ||
        request.id ||
        request.name
      );

    const action =
      request.connectorAction ||
      request.action ||
      request.method ||
      request.operation ||
      'execute';

    const payload =
      request.payload ||
      request.input ||
      {};

    if (!connectorId) {
      return {
        ok: false,
        service:
          this.service,
        status:
          'CONNECTOR_ID_REQUIRED'
      };
    }

    if (
      !this.connectors.has(
        connectorId
      )
    ) {
      const autoLoadResult =
        this.tryAutoLoadConnector(
          connectorId
        );

      if (!autoLoadResult.ok) {
        return autoLoadResult;
      }
    }

    const connector =
      this.connectors.get(
        connectorId
      );

    const executionId =
      `${connectorId}_${action}_${Date.now()}`;

    this.state.executionsStarted +=
      1;

    this.state.lastExecutionAt =
      this.now();

    this.persistState();

    this.appendExecutionLog({
      executionId,
      connectorId,
      action,
      status:
        'STARTED',
      request
    });

    try {
      const result =
        await this.callConnector(
          connector.instance,
          action,
          payload,
          request
        );

      const resultSucceeded =
        !(
          result &&
          result.ok === false
        );

      if (!resultSucceeded) {
        throw new Error(
          result.error ||
          result.message ||
          `Connector returned an unsuccessful result for ${connectorId}.${action}`
        );
      }

      this.state.executionsCompleted +=
        1;

      this.state.status =
        'CONNECTOR_EXECUTION_COMPLETED';

      this.state.lastError =
        null;

      this.persistState();

      this.appendExecutionLog({
        executionId,
        connectorId,
        action,
        status:
          'COMPLETED',
        result
      });

      return {
        ok: true,
        service:
          this.service,
        status:
          'CONNECTOR_EXECUTION_COMPLETED',
        executionId,
        connectorId,
        action,
        result
      };
    } catch (error) {
      this.state.executionsFailed +=
        1;

      this.state.status =
        'CONNECTOR_EXECUTION_FAILED';

      this.state.lastError =
        error.stack ||
        error.message;

      this.persistState();

      this.appendExecutionLog({
        executionId,
        connectorId,
        action,
        status:
          'FAILED',
        error:
          error.message
      });

      return {
        ok: false,
        service:
          this.service,
        status:
          'CONNECTOR_EXECUTION_FAILED',
        executionId,
        connectorId,
        action,
        error:
          error.message
      };
    }
  }

  async callConnector(
    instance,
    action,
    payload,
    request
  ) {
    if (!instance) {
      throw new Error(
        'Connector instance is unavailable.'
      );
    }

    if (
      typeof instance[action] ===
      'function'
    ) {
      return await instance[action](
        payload,
        request
      );
    }

    const connectorTask = {
      ...request,
      action,
      connectorAction:
        action,
      method:
        action,
      operation:
        action,
      payload,
      input:
        payload,
      request
    };

    if (
      typeof instance.execute ===
      'function'
    ) {
      return await instance.execute(
        connectorTask,
        request
      );
    }

    if (
      typeof instance.run ===
      'function'
    ) {
      return await instance.run(
        connectorTask,
        request
      );
    }

    if (
      typeof instance.handle ===
      'function'
    ) {
      return await instance.handle(
        connectorTask,
        request
      );
    }

    throw new Error(
      `Connector does not support action: ${action}`
    );
  }

  listConnectors() {
    return {
      ok: true,
      service:
        this.service,
      version:
        this.version,
      status:
        'CONNECTORS_LISTED',
      connectors: [
        ...this.connectors.values()
      ].map(
        connector => ({
          connectorId:
            connector.connectorId,
          connectorName:
            connector.connectorName,
          connectorPath:
            connector.connectorPath,
          connectorType:
            connector.connectorType,
          loadedAt:
            connector.loadedAt,
          status:
            connector.status
        })
      ),
      generatedAt:
        this.now()
    };
  }

  async healthCheck() {
    const connectorDirExists =
      fs.existsSync(
        this.connectorDir
      );

    const statePathExists =
      fs.existsSync(
        this.statePath
      );

    const executionLogExists =
      fs.existsSync(
        this.executionLogPath
      );

    const connectorHealth = [];

    for (
      const connector
      of this.connectors.values()
    ) {
      let health;

      try {
        if (
          connector.instance &&
          typeof connector.instance.healthCheck ===
          'function'
        ) {
          health =
            await connector.instance.healthCheck();

          health = {
            ...health,
            connectorId:
              connector.connectorId
          };
        } else {
          health = {
            connectorId:
              connector.connectorId,
            ok: true,
            status:
              'LOADED_NO_HEALTHCHECK'
          };
        }
      } catch (error) {
        health = {
          connectorId:
            connector.connectorId,
          ok: false,
          status:
            'HEALTHCHECK_FAILED',
          error:
            error.message
        };
      }

      connectorHealth.push(
        health
      );
    }

    const ok =
      connectorDirExists &&
      statePathExists &&
      executionLogExists &&
      connectorHealth.every(
        item =>
          item.ok !== false
      );

    return {
      ok,
      service:
        this.service,
      version:
        this.version,
      status:
        ok
          ? 'HEALTHY'
          : 'DEGRADED',
      connectorDir:
        this.connectorDir,
      connectorDirExists,
      statePath:
        this.statePath,
      statePathExists,
      executionLogPath:
        this.executionLogPath,
      executionLogExists,
      connectorsLoaded:
        this.connectors.size,
      connectorHealth,
      state:
        this.getState(),
      generatedAt:
        this.now()
    };
  }

  getState() {
    return {
      ...this.state,
      connectorsLoaded:
        this.connectors.size,
      loadedConnectors: [
        ...this.connectors.keys()
      ],
      generatedAt:
        this.now()
    };
  }
}

module.exports =
  ConnectorRuntime;

module.exports.ConnectorRuntime =
  ConnectorRuntime;

module.exports.default =
  ConnectorRuntime;