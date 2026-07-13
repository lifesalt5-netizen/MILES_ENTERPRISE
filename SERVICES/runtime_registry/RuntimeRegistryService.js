'use strict';

/*
  MILES Enterprise
  File: SERVICES/runtime_registry/RuntimeRegistryService.js
  Version: 2.0.2

  Purpose:
  - Maintain the authoritative live runtime registry.
  - Actively probe MILES HTTP and TCP services.
  - Maintain the registry service's own heartbeat.
  - Prevent overlapping discovery cycles.
  - Retry transient HTTP failures before marking a service DOWN.
  - Clear stale errors when a service recovers.
  - Persist service health, summaries, and lifecycle events.
*/

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

class RuntimeRegistryService {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.rootDir ||
      process.env.MILES_ROOT ||
      process.cwd()
    );

    this.runtimeDir = path.resolve(
      options.runtimeDir ||
      path.join(
        this.rootDir,
        'runtime',
        'runtime_registry_v2'
      )
    );

    this.registryPath = path.join(
      this.runtimeDir,
      'runtime_registry.json'
    );

    this.summaryPath = path.join(
      this.runtimeDir,
      'runtime_registry_summary.json'
    );

    this.eventsPath = path.join(
      this.runtimeDir,
      'runtime_registry_events.jsonl'
    );

    this.pidPath = path.join(
      this.runtimeDir,
      'runtime_registry_service.pid'
    );

    this.probesPath = path.join(
      this.runtimeDir,
      'runtime_probes.json'
    );

    this.service = 'RUNTIME_REGISTRY_SERVICE_V2';
    this.version = '2.0.2';

    this.host =
      options.host ||
      process.env.MILES_RUNTIME_REGISTRY_HOST ||
      '127.0.0.1';

    this.port = this.positiveInteger(
      options.port ||
      process.env.MILES_RUNTIME_REGISTRY_PORT,
      8791
    );

    this.pollIntervalMs = this.positiveInteger(
      options.pollIntervalMs ||
      process.env.MILES_RUNTIME_REGISTRY_INTERVAL_MS,
      15000
    );

    this.staleAfterMs = this.positiveInteger(
      options.staleAfterMs ||
      process.env.MILES_RUNTIME_REGISTRY_STALE_MS,
      120000
    );

    this.httpTimeoutMs = this.positiveInteger(
      options.httpTimeoutMs ||
      process.env.MILES_RUNTIME_REGISTRY_HTTP_TIMEOUT_MS,
      5000
    );

    this.httpProbeAttempts = this.positiveInteger(
      options.httpProbeAttempts ||
      process.env.MILES_RUNTIME_REGISTRY_HTTP_ATTEMPTS,
      3
    );

    this.httpRetryDelayMs = this.positiveInteger(
      options.httpRetryDelayMs ||
      process.env.MILES_RUNTIME_REGISTRY_HTTP_RETRY_DELAY_MS,
      500
    );

    this.tcpTimeoutMs = this.positiveInteger(
      options.tcpTimeoutMs ||
      process.env.MILES_RUNTIME_REGISTRY_TCP_TIMEOUT_MS,
      3000
    );

    this.records = new Map();

    this.server = null;
    this.timer = null;
    this.startedAt = null;
    this.discoveryRunning = false;
    this.stopping = false;

    this.defaultProbes = [
      {
        id: 'DESKTOP_UI',
        name: 'MILES Desktop UI',
        type: 'HTTP_SERVICE',
        host: '127.0.0.1',
        port: 3737,
        protocol: 'http',
        path: '/api/status',
        fallbackPaths: ['/'],
        capabilities: [
          'DISPLAY_DASHBOARD'
        ]
      },
      {
        id: 'MILES_API',
        name: 'MILES API',
        type: 'HTTP_SERVICE',
        host: '127.0.0.1',
        port: 3000,
        protocol: 'http',
        path: '/',
        fallbackPaths: ['/health', '/api/health'],
        capabilities: [
          'SERVE_API'
        ]
      },
      {
        id: 'COMMAND_CENTER',
        name: 'Miles Command Center',
        type: 'HTTP_SERVICE',
        host: '127.0.0.1',
        port: 8787,
        protocol: 'http',
        path: '/',
        fallbackPaths: [],
        capabilities: [
          'COMMAND_AND_CONTROL'
        ]
      }
    ];

    this.ensureStorage();
    this.load();
  }

  now() {
    return new Date().toISOString();
  }

  positiveInteger(value, fallback) {
    const parsed = Number(value);

    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : fallback;
  }

  sleep(milliseconds) {
    return new Promise(resolve => {
      setTimeout(resolve, milliseconds);
    });
  }

  ensureStorage() {
    fs.mkdirSync(
      this.runtimeDir,
      {
        recursive: true
      }
    );

    if (!fs.existsSync(this.registryPath)) {
      this.atomicWrite(
        this.registryPath,
        {
          ok: true,
          service: this.service,
          version: this.version,
          services: [],
          generatedAt: this.now()
        }
      );
    }

    if (!fs.existsSync(this.summaryPath)) {
      this.atomicWrite(
        this.summaryPath,
        {}
      );
    }

    if (!fs.existsSync(this.eventsPath)) {
      fs.writeFileSync(
        this.eventsPath,
        '',
        'utf8'
      );
    }

    if (!fs.existsSync(this.probesPath)) {
      this.atomicWrite(
        this.probesPath,
        []
      );
    }
  }

  load() {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(
          this.registryPath,
          'utf8'
        )
      );

      const services = Array.isArray(parsed.services)
        ? parsed.services
        : [];

      for (const record of services) {
        if (!record || !record.id) {
          continue;
        }

        this.records.set(
          this.normalizeId(record.id),
          record
        );
      }
    } catch {
      this.records.clear();
    }
  }

  normalizeId(value) {
    return String(value || '')
      .trim()
      .replace(
        /[^A-Za-z0-9_.:-]+/g,
        '_'
      )
      .toUpperCase();
  }

  unique(values = []) {
    return [
      ...new Set(
        values
          .filter(Boolean)
          .map(value => String(value))
      )
    ];
  }

  isHealthyStatus(status) {
    return [
      'RUNNING',
      'HEALTHY'
    ].includes(
      String(status || '').toUpperCase()
    );
  }

  register(payload = {}) {
    const id = this.normalizeId(
      payload.id ||
      payload.serviceId ||
      payload.name
    );

    if (!id) {
      return {
        ok: false,
        status: 'SERVICE_ID_REQUIRED'
      };
    }

    const existing =
      this.records.get(id) ||
      {};

    const status =
      payload.status ||
      existing.status ||
      'REGISTERED';

    const isHealthy =
      this.isHealthyStatus(status);

    const timestamp =
      this.now();

    const record = {
      id,

      name:
        payload.name ||
        existing.name ||
        id,

      type:
        payload.type ||
        existing.type ||
        'SERVICE',

      domain:
        payload.domain ??
        existing.domain ??
        null,

      version:
        payload.version ||
        existing.version ||
        null,

      status,

      pid:
        payload.pid ??
        existing.pid ??
        null,

      host:
        payload.host ||
        existing.host ||
        null,

      port:
        payload.port ??
        existing.port ??
        null,

      protocol:
        payload.protocol ||
        existing.protocol ||
        null,

      path:
        payload.path ||
        existing.path ||
        null,

      fallbackPaths: this.unique([
        ...(existing.fallbackPaths || []),
        ...(payload.fallbackPaths || [])
      ]),

      capabilities: this.unique([
        ...(existing.capabilities || []),
        ...(payload.capabilities || [])
      ]),

      dependencies: this.unique([
        ...(existing.dependencies || []),
        ...(payload.dependencies || [])
      ]),

      approvalRequiredActions: this.unique([
        ...(existing.approvalRequiredActions || []),
        ...(payload.approvalRequiredActions || [])
      ]),

      healthSource:
        payload.healthSource ||
        existing.healthSource ||
        'SELF_REGISTERED',

      source:
        payload.source ||
        existing.source ||
        'RUNTIME_REGISTRY_API',

      startedAt:
        existing.startedAt ||
        payload.startedAt ||
        timestamp,

      registeredAt:
        existing.registeredAt ||
        timestamp,

      heartbeatAt:
        timestamp,

      lastHealthyAt:
        isHealthy
          ? timestamp
          : (
              existing.lastHealthyAt ||
              null
            ),

      lastError:
        isHealthy
          ? null
          : (
              payload.lastError ??
              existing.lastError ??
              null
            ),

      lastFailureAt:
        !isHealthy && payload.lastError
          ? timestamp
          : (
              existing.lastFailureAt ||
              null
            ),

      restartCount:
        payload.restartCount ??
        existing.restartCount ??
        0,

      consecutiveSuccesses:
        isHealthy
          ? (
              Number(existing.consecutiveSuccesses || 0) +
              1
            )
          : 0,

      consecutiveFailures:
        isHealthy
          ? 0
          : (
              Number(existing.consecutiveFailures || 0) +
              1
            ),

      metadata: {
        ...(existing.metadata || {}),
        ...(payload.metadata || {})
      }
    };

    this.records.set(
      id,
      record
    );

    this.appendEvent(
      'SERVICE_REGISTERED',
      {
        id: record.id,
        name: record.name,
        status: record.status,
        pid: record.pid,
        host: record.host,
        port: record.port,
        healthSource: record.healthSource
      }
    );

    this.persist();

    return {
      ok: true,
      status: 'SERVICE_REGISTERED',
      service: record
    };
  }

  heartbeat(id, patch = {}) {
    const normalizedId =
      this.normalizeId(id);

    const existing =
      this.records.get(normalizedId);

    if (!existing) {
      return this.register({
        id: normalizedId,
        ...patch,
        status:
          patch.status ||
          'RUNNING'
      });
    }

    const status =
      patch.status ||
      existing.status ||
      'RUNNING';

    const isHealthy =
      this.isHealthyStatus(status);

    const timestamp =
      this.now();

    const next = {
      ...existing,
      ...patch,

      id:
        normalizedId,

      status,

      heartbeatAt:
        timestamp,

      lastHealthyAt:
        isHealthy
          ? timestamp
          : existing.lastHealthyAt,

      lastError:
        isHealthy
          ? null
          : (
              patch.lastError ??
              existing.lastError ??
              null
            ),

      lastFailureAt:
        !isHealthy && patch.lastError
          ? timestamp
          : existing.lastFailureAt,

      consecutiveSuccesses:
        isHealthy
          ? (
              Number(existing.consecutiveSuccesses || 0) +
              1
            )
          : 0,

      consecutiveFailures:
        isHealthy
          ? 0
          : (
              Number(existing.consecutiveFailures || 0) +
              1
            ),

      capabilities: this.unique([
        ...(existing.capabilities || []),
        ...(patch.capabilities || [])
      ]),

      dependencies: this.unique([
        ...(existing.dependencies || []),
        ...(patch.dependencies || [])
      ])
    };

    this.records.set(
      normalizedId,
      next
    );

    this.appendEvent(
      'SERVICE_HEARTBEAT',
      {
        id: normalizedId,
        status: next.status,
        pid: next.pid
      }
    );

    this.persist();

    return {
      ok: true,
      status: 'HEARTBEAT_RECORDED',
      service: next
    };
  }

  deregister(
    id,
    reason = null
  ) {
    const normalizedId =
      this.normalizeId(id);

    const existing =
      this.records.get(normalizedId);

    if (!existing) {
      return {
        ok: false,
        status: 'SERVICE_NOT_FOUND',
        id: normalizedId
      };
    }

    const timestamp =
      this.now();

    const next = {
      ...existing,

      status:
        'DOWN',

      pid:
        null,

      heartbeatAt:
        timestamp,

      lastError:
        reason ||
        existing.lastError ||
        'Service deregistered.',

      lastFailureAt:
        timestamp,

      consecutiveSuccesses:
        0,

      consecutiveFailures:
        Number(existing.consecutiveFailures || 0) +
        1
    };

    this.records.set(
      normalizedId,
      next
    );

    this.appendEvent(
      'SERVICE_DEREGISTERED',
      {
        id: normalizedId,
        reason
      }
    );

    this.persist();

    return {
      ok: true,
      status: 'SERVICE_DEREGISTERED',
      service: next
    };
  }

  list() {
    return [
      ...this.records.values()
    ].sort(
      (a, b) =>
        a.id.localeCompare(b.id)
    );
  }

  get(id) {
    return (
      this.records.get(
        this.normalizeId(id)
      ) ||
      null
    );
  }

  getCapabilityProviders(capability) {
    const target =
      String(capability || '')
        .toUpperCase();

    return this.list().filter(record =>
      (record.capabilities || [])
        .map(value =>
          String(value)
            .toUpperCase()
        )
        .includes(target)
    );
  }

  async probeEndpoint(probe) {
    const startedAt =
      Date.now();

    let result;

    if (
      String(probe.protocol || '')
        .toLowerCase() === 'tcp'
    ) {
      result = await this.probeTcp(
        probe.host,
        probe.port
      );
    } else {
      result = await this.probeHttpWithRetries(
        probe
      );
    }

    return {
      ...probe,
      ...result,
      latencyMs:
        Date.now() -
        startedAt,
      checkedAt:
        this.now()
    };
  }

  probeTcp(host, port) {
    return new Promise(resolve => {
      const socket =
        new net.Socket();

      let settled =
        false;

      const finish = value => {
        if (settled) {
          return;
        }

        settled = true;

        try {
          socket.destroy();
        } catch {}

        resolve(value);
      };

      socket.setTimeout(
        this.tcpTimeoutMs
      );

      socket.once(
        'connect',
        () => {
          finish({
            ok: true,
            status: 'RUNNING'
          });
        }
      );

      socket.once(
        'timeout',
        () => {
          finish({
            ok: false,
            status: 'DOWN',
            error: `TCP timeout after ${this.tcpTimeoutMs}ms`
          });
        }
      );

      socket.once(
        'error',
        error => {
          finish({
            ok: false,
            status: 'DOWN',
            error: error.message
          });
        }
      );

      socket.connect(
        Number(port),
        host
      );
    });
  }

  async probeHttpWithRetries(probe) {
    const paths = this.unique([
      probe.path || '/',
      ...(probe.fallbackPaths || [])
    ]);

    const attemptHistory = [];
    let lastFailure = null;

    for (
      let attempt = 1;
      attempt <= this.httpProbeAttempts;
      attempt += 1
    ) {
      for (const probePath of paths) {
        const result =
          await this.probeHttpOnce({
            ...probe,
            path: probePath
          });

        attemptHistory.push({
          attempt,
          path: probePath,
          ok: result.ok,
          httpStatus:
            result.httpStatus ??
            null,
          error:
            result.error ||
            null,
          latencyMs:
            result.latencyMs
        });

        if (result.ok) {
          return {
            ...result,
            status:
              'RUNNING',
            attempts:
              attempt,
            successfulPath:
              probePath,
            attemptHistory
          };
        }

        lastFailure = {
          ...result,
          attemptedPath:
            probePath
        };
      }

      if (
        attempt <
        this.httpProbeAttempts
      ) {
        await this.sleep(
          this.httpRetryDelayMs
        );
      }
    }

    return {
      ok: false,
      status: 'DOWN',
      error:
        lastFailure?.error ||
        `HTTP probe failed after ${this.httpProbeAttempts} attempts`,
      httpStatus:
        lastFailure?.httpStatus ??
        null,
      attempts:
        this.httpProbeAttempts,
      attemptedPath:
        lastFailure?.attemptedPath ||
        probe.path ||
        '/',
      attemptHistory
    };
  }

  probeHttpOnce(probe) {
    return new Promise(resolve => {
      const startedAt =
        Date.now();

      let settled =
        false;

      const finish = value => {
        if (settled) {
          return;
        }

        settled = true;

        resolve({
          ...value,
          latencyMs:
            Date.now() -
            startedAt
        });
      };

      const request = http.request(
        {
          host:
            probe.host,

          port:
            Number(probe.port),

          path:
            probe.path ||
            '/',

          method:
            'GET',

          timeout:
            this.httpTimeoutMs,

          headers: {
            Connection:
              'close',

            'User-Agent':
              `MILES-Runtime-Registry/${this.version}`,

            Accept:
              'application/json,text/plain,text/html,*/*'
          },

          agent:
            false
        },

        response => {
          response.resume();

          response.once(
            'end',
            () => {
              finish({
                ok: true,
                status:
                  'RUNNING',
                httpStatus:
                  response.statusCode,
                responseComplete:
                  true
              });
            }
          );

          response.once(
            'aborted',
            () => {
              finish({
                ok: true,
                status:
                  'RUNNING',
                httpStatus:
                  response.statusCode,
                responseComplete:
                  false
              });
            }
          );

          response.once(
            'error',
            error => {
              finish({
                ok: true,
                status:
                  'RUNNING',
                httpStatus:
                  response.statusCode,
                responseComplete:
                  false,
                responseError:
                  error.message
              });
            }
          );
        }
      );

      request.once(
        'socket',
        socket => {
          socket.setTimeout(
            this.httpTimeoutMs
          );
        }
      );

      request.once(
        'timeout',
        () => {
          request.destroy();

          finish({
            ok: false,
            status:
              'DOWN',
            error:
              `HTTP timeout after ${this.httpTimeoutMs}ms`
          });
        }
      );

      request.once(
        'error',
        error => {
          finish({
            ok: false,
            status:
              'DOWN',
            error:
              error.message
          });
        }
      );

      request.end();
    });
  }

  async runDiscoveryCycle() {
    if (this.discoveryRunning) {
      return {
        ok: true,
        status:
          'DISCOVERY_CYCLE_ALREADY_RUNNING',
        generatedAt:
          this.now()
      };
    }

    this.discoveryRunning =
      true;

    try {
      this.heartbeat(
        this.service,
        {
          status:
            'RUNNING',

          pid:
            process.pid,

          host:
            this.host,

          port:
            this.port,

          protocol:
            'http',

          healthSource:
            'SELF_REGISTERED',

          source:
            'SELF',

          lastError:
            null
        }
      );

      const configured =
        this.loadConfiguredProbes();

      const probes = [
        ...this.defaultProbes,
        ...configured
      ];

      const deduped =
        new Map();

      for (const probe of probes) {
        const id =
          this.normalizeId(
            probe.id ||
            probe.name
          );

        if (!id) {
          continue;
        }

        deduped.set(
          id,
          {
            ...probe,
            id
          }
        );
      }

      const results = [];

      for (const probe of deduped.values()) {
        const result =
          await this.probeEndpoint(
            probe
          );

        results.push(
          result
        );

        this.register({
          ...probe,

          id:
            this.normalizeId(
              probe.id ||
              probe.name
            ),

          status:
            result.status,

          healthSource:
            'ACTIVE_PROBE',

          lastError:
            result.ok
              ? null
              : (
                  result.error ||
                  'Health probe failed.'
                ),

          metadata: {
            ...(probe.metadata || {}),

            latencyMs:
              result.latencyMs,

            httpStatus:
              result.httpStatus ??
              null,

            checkedAt:
              result.checkedAt,

            attempts:
              result.attempts ??
              1,

            successfulPath:
              result.successfulPath ??
              null,

            attemptedPath:
              result.attemptedPath ??
              null,

            attemptHistory:
              result.attemptHistory ||
              []
          }
        });
      }

      this.markStaleRecords();
      this.persist();

      return {
        ok: true,

        status:
          'DISCOVERY_CYCLE_COMPLETED',

        checked:
          results.length,

        healthy:
          results.filter(
            item => item.ok
          ).length,

        unhealthy:
          results.filter(
            item => !item.ok
          ).length,

        results,

        generatedAt:
          this.now()
      };
    } catch (error) {
      this.appendEvent(
        'DISCOVERY_CYCLE_FAILED',
        {
          error:
            error.stack ||
            error.message
        }
      );

      throw error;
    } finally {
      this.discoveryRunning =
        false;
    }
  }

  loadConfiguredProbes() {
    if (!fs.existsSync(this.probesPath)) {
      this.atomicWrite(
        this.probesPath,
        []
      );

      return [];
    }

    try {
      const parsed =
        JSON.parse(
          fs.readFileSync(
            this.probesPath,
            'utf8'
          )
        );

      return Array.isArray(parsed)
        ? parsed
        : [];
    } catch (error) {
      this.appendEvent(
        'PROBE_CONFIGURATION_READ_FAILED',
        {
          path:
            this.probesPath,

          error:
            error.message
        }
      );

      return [];
    }
  }

  markStaleRecords() {
    const current =
      Date.now();

    for (
      const [id, record]
      of this.records.entries()
    ) {
      if (!record.heartbeatAt) {
        continue;
      }

      const heartbeat =
        Date.parse(
          record.heartbeatAt
        );

      if (!Number.isFinite(heartbeat)) {
        continue;
      }

      if (
        current - heartbeat >
          this.staleAfterMs &&
        this.isHealthyStatus(
          record.status
        ) &&
        record.healthSource !==
          'ACTIVE_PROBE'
      ) {
        this.records.set(
          id,
          {
            ...record,

            status:
              'STALE',

            lastError:
              `No heartbeat received within ${this.staleAfterMs}ms.`,

            lastFailureAt:
              this.now(),

            consecutiveSuccesses:
              0,

            consecutiveFailures:
              Number(
                record.consecutiveFailures ||
                0
              ) + 1
          }
        );
      }
    }
  }

  buildSummary() {
    const services =
      this.list();

    const countByStatus = {};
    const countByType = {};

    for (const record of services) {
      countByStatus[
        record.status
      ] =
        (
          countByStatus[
            record.status
          ] ||
          0
        ) +
        1;

      countByType[
        record.type
      ] =
        (
          countByType[
            record.type
          ] ||
          0
        ) +
        1;
    }

    const unhealthy =
      services.filter(
        record =>
          [
            'DOWN',
            'ERROR',
            'STALE',
            'DEGRADED'
          ].includes(
            String(
              record.status ||
              ''
            ).toUpperCase()
          )
      );

    return {
      ok:
        unhealthy.length ===
        0,

      service:
        this.service,

      version:
        this.version,

      status:
        unhealthy.length
          ? 'DEGRADED'
          : 'HEALTHY',

      host:
        this.host,

      port:
        this.port,

      pid:
        process.pid,

      startedAt:
        this.startedAt,

      uptimeSeconds:
        this.startedAt
          ? Math.floor(
              (
                Date.now() -
                Date.parse(
                  this.startedAt
                )
              ) /
              1000
            )
          : 0,

      totalServices:
        services.length,

      countByStatus,
      countByType,

      unhealthyServices:
        unhealthy.map(
          record => ({
            id:
              record.id,

            status:
              record.status,

            lastError:
              record.lastError,

            heartbeatAt:
              record.heartbeatAt,

            lastHealthyAt:
              record.lastHealthyAt,

            consecutiveFailures:
              record.consecutiveFailures ||
              0
          })
        ),

      capabilityCount:
        this.unique(
          services.flatMap(
            record =>
              record.capabilities ||
              []
          )
        ).length,

      discoveryRunning:
        this.discoveryRunning,

      pollIntervalMs:
        this.pollIntervalMs,

      httpTimeoutMs:
        this.httpTimeoutMs,

      httpProbeAttempts:
        this.httpProbeAttempts,

      generatedAt:
        this.now()
    };
  }

  persist() {
    const payload = {
      ok: true,

      service:
        this.service,

      version:
        this.version,

      rootDir:
        this.rootDir,

      services:
        this.list(),

      generatedAt:
        this.now()
    };

    this.atomicWrite(
      this.registryPath,
      payload
    );

    this.atomicWrite(
      this.summaryPath,
      this.buildSummary()
    );
  }

  appendEvent(
    eventType,
    payload
  ) {
    try {
      fs.appendFileSync(
        this.eventsPath,

        JSON.stringify({
          eventType,
          payload,
          generatedAt:
            this.now()
        }) + '\n',

        'utf8'
      );
    } catch (error) {
      console.error(
        `[RUNTIME REGISTRY] Event write failed: ${error.message}`
      );
    }
  }

  atomicWrite(
    filePath,
    value
  ) {
    const tempPath =
      `${filePath}.${process.pid}.${Date.now()}.tmp`;

    const text =
      JSON.stringify(
        value,
        null,
        2
      );

    try {
      fs.writeFileSync(
        tempPath,
        text,
        'utf8'
      );

      fs.renameSync(
        tempPath,
        filePath
      );
    } catch {
      try {
        fs.writeFileSync(
          filePath,
          text,
          'utf8'
        );
      } finally {
        try {
          if (
            fs.existsSync(
              tempPath
            )
          ) {
            fs.unlinkSync(
              tempPath
            );
          }
        } catch {}
      }
    }
  }

  sendJson(
    response,
    statusCode,
    payload
  ) {
    if (
      response.headersSent ||
      response.writableEnded
    ) {
      return;
    }

    response.writeHead(
      statusCode,
      {
        'Content-Type':
          'application/json; charset=utf-8',

        'Cache-Control':
          'no-store',

        Connection:
          'close'
      }
    );

    response.end(
      JSON.stringify(
        payload,
        null,
        2
      )
    );
  }

  async readJsonBody(request) {
    const chunks = [];

    for await (
      const chunk
      of request
    ) {
      chunks.push(chunk);
    }

    if (!chunks.length) {
      return {};
    }

    const raw =
      Buffer.concat(
        chunks
      ).toString('utf8');

    return JSON.parse(raw);
  }

  async handleRequest(
    request,
    response
  ) {
    try {
      const url =
        new URL(
          request.url,
          `http://${this.host}:${this.port}`
        );

      if (
        request.method ===
          'GET' &&
        url.pathname ===
          '/health'
      ) {
        return this.sendJson(
          response,
          200,
          this.buildSummary()
        );
      }

      if (
        request.method ===
          'GET' &&
        url.pathname ===
          '/services'
      ) {
        return this.sendJson(
          response,
          200,
          {
            ok: true,
            services:
              this.list(),
            generatedAt:
              this.now()
          }
        );
      }

      if (
        request.method ===
          'GET' &&
        url.pathname.startsWith(
          '/services/'
        )
      ) {
        const id =
          decodeURIComponent(
            url.pathname.slice(
              '/services/'.length
            )
          );

        const service =
          this.get(id);

        return this.sendJson(
          response,
          service
            ? 200
            : 404,

          service
            ? {
                ok: true,
                service
              }
            : {
                ok: false,
                status:
                  'SERVICE_NOT_FOUND',
                id
              }
        );
      }

      if (
        request.method ===
          'GET' &&
        url.pathname.startsWith(
          '/capabilities/'
        )
      ) {
        const capability =
          decodeURIComponent(
            url.pathname.slice(
              '/capabilities/'.length
            )
          );

        return this.sendJson(
          response,
          200,
          {
            ok: true,

            capability,

            providers:
              this.getCapabilityProviders(
                capability
              ),

            generatedAt:
              this.now()
          }
        );
      }

      if (
        request.method ===
          'POST' &&
        url.pathname ===
          '/register'
      ) {
        const body =
          await this.readJsonBody(
            request
          );

        const result =
          this.register(body);

        return this.sendJson(
          response,
          result.ok
            ? 200
            : 400,
          result
        );
      }

      if (
        request.method ===
          'POST' &&
        url.pathname.startsWith(
          '/heartbeat/'
        )
      ) {
        const id =
          decodeURIComponent(
            url.pathname.slice(
              '/heartbeat/'.length
            )
          );

        const body =
          await this.readJsonBody(
            request
          );

        return this.sendJson(
          response,
          200,
          this.heartbeat(
            id,
            body
          )
        );
      }

      if (
        request.method ===
          'POST' &&
        url.pathname.startsWith(
          '/deregister/'
        )
      ) {
        const id =
          decodeURIComponent(
            url.pathname.slice(
              '/deregister/'.length
            )
          );

        const body =
          await this.readJsonBody(
            request
          );

        return this.sendJson(
          response,
          200,
          this.deregister(
            id,
            body.reason ||
            null
          )
        );
      }

      if (
        request.method ===
          'POST' &&
        url.pathname ===
          '/discover'
      ) {
        const result =
          await this.runDiscoveryCycle();

        return this.sendJson(
          response,
          200,
          result
        );
      }

      return this.sendJson(
        response,
        404,
        {
          ok: false,

          status:
            'ROUTE_NOT_FOUND',

          method:
            request.method,

          path:
            url.pathname
        }
      );
    } catch (error) {
      return this.sendJson(
        response,
        500,
        {
          ok: false,

          status:
            'RUNTIME_REGISTRY_REQUEST_FAILED',

          error:
            error.message
        }
      );
    }
  }

  async start() {
    if (this.server) {
      return {
        ok: true,

        status:
          'ALREADY_RUNNING',

        host:
          this.host,

        port:
          this.port,

        pid:
          process.pid
      };
    }

    this.stopping =
      false;

    this.startedAt =
      this.now();

    this.register({
      id:
        this.service,

      name:
        'MILES Runtime Registry Service V2',

      type:
        'REGISTRY_SERVICE',

      version:
        this.version,

      status:
        'RUNNING',

      pid:
        process.pid,

      host:
        this.host,

      port:
        this.port,

      protocol:
        'http',

      capabilities: [
        'REGISTER_RUNTIME_SERVICE',
        'TRACK_RUNTIME_HEALTH',
        'RESOLVE_LIVE_CAPABILITY_PROVIDER',
        'DISCOVER_LOCAL_SERVICE'
      ],

      healthSource:
        'SELF_REGISTERED',

      source:
        'SELF',

      lastError:
        null
    });

    this.server =
      http.createServer(
        (
          request,
          response
        ) => {
          this.handleRequest(
            request,
            response
          ).catch(error => {
            this.sendJson(
              response,
              500,
              {
                ok: false,
                status:
                  'UNHANDLED_REGISTRY_REQUEST_ERROR',
                error:
                  error.message
              }
            );
          });
        }
      );

    this.server.keepAliveTimeout =
      5000;

    this.server.headersTimeout =
      7000;

    await new Promise(
      (
        resolve,
        reject
      ) => {
        const onError = error => {
          reject(error);
        };

        this.server.once(
          'error',
          onError
        );

        this.server.listen(
          this.port,
          this.host,
          () => {
            this.server.removeListener(
              'error',
              onError
            );

            resolve();
          }
        );
      }
    );

    fs.writeFileSync(
      this.pidPath,
      String(process.pid),
      'utf8'
    );

    await this.runDiscoveryCycle();

    this.timer =
      setInterval(
        () => {
          this.runDiscoveryCycle()
            .catch(error => {
              this.appendEvent(
                'DISCOVERY_CYCLE_FAILED',
                {
                  error:
                    error.stack ||
                    error.message
                }
              );
            });
        },

        this.pollIntervalMs
      );

    this.timer.unref();

    this.appendEvent(
      'RUNTIME_REGISTRY_STARTED',
      {
        service:
          this.service,

        version:
          this.version,

        host:
          this.host,

        port:
          this.port,

        pid:
          process.pid
      }
    );

    return {
      ok: true,

      status:
        'RUNTIME_REGISTRY_STARTED',

      version:
        this.version,

      host:
        this.host,

      port:
        this.port,

      pid:
        process.pid,

      generatedAt:
        this.now()
    };
  }

  async stop() {
    if (this.stopping) {
      return {
        ok: true,
        status:
          'RUNTIME_REGISTRY_ALREADY_STOPPING',
        generatedAt:
          this.now()
      };
    }

    this.stopping =
      true;

    if (this.timer) {
      clearInterval(
        this.timer
      );

      this.timer =
        null;
    }

    this.deregister(
      this.service,
      'Service stopped.'
    );

    if (this.server) {
      await new Promise(resolve => {
        this.server.close(() => {
          resolve();
        });
      });

      this.server =
        null;
    }

    try {
      if (
        fs.existsSync(
          this.pidPath
        )
      ) {
        fs.unlinkSync(
          this.pidPath
        );
      }
    } catch {}

    this.appendEvent(
      'RUNTIME_REGISTRY_STOPPED',
      {
        service:
          this.service,

        version:
          this.version,

        generatedAt:
          this.now()
      }
    );

    return {
      ok: true,

      status:
        'RUNTIME_REGISTRY_STOPPED',

      generatedAt:
        this.now()
    };
  }
}

module.exports =
  RuntimeRegistryService;