'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

class RuntimeRegistryService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.runtimeDir = path.resolve(
      options.runtimeDir || path.join(this.rootDir, 'runtime', 'runtime_registry_v2')
    );

    this.registryPath = path.join(this.runtimeDir, 'runtime_registry.json');
    this.summaryPath = path.join(this.runtimeDir, 'runtime_registry_summary.json');
    this.eventsPath = path.join(this.runtimeDir, 'runtime_registry_events.jsonl');
    this.pidPath = path.join(this.runtimeDir, 'runtime_registry_service.pid');

    this.service = 'RUNTIME_REGISTRY_SERVICE_V2';
    this.version = '2.0.0';

    this.host = options.host || process.env.MILES_RUNTIME_REGISTRY_HOST || '127.0.0.1';
    this.port = Number(options.port || process.env.MILES_RUNTIME_REGISTRY_PORT || 8791);
    this.pollIntervalMs = Number(
      options.pollIntervalMs || process.env.MILES_RUNTIME_REGISTRY_INTERVAL_MS || 15000
    );
    this.staleAfterMs = Number(
      options.staleAfterMs || process.env.MILES_RUNTIME_REGISTRY_STALE_MS || 120000
    );

    this.records = new Map();
    this.server = null;
    this.timer = null;
    this.startedAt = null;

    this.defaultProbes = [
      {
        id: 'DESKTOP_UI',
        name: 'MILES Desktop UI',
        type: 'HTTP_SERVICE',
        host: '127.0.0.1',
        port: 3737,
        protocol: 'http',
        path: '/',
        capabilities: ['DISPLAY_DASHBOARD']
      },
      {
        id: 'MILES_API',
        name: 'MILES API',
        type: 'HTTP_SERVICE',
        host: '127.0.0.1',
        port: 3000,
        protocol: 'http',
        path: '/',
        capabilities: ['SERVE_API']
      },
      {
        id: 'COMMAND_CENTER',
        name: 'Miles Command Center',
        type: 'HTTP_SERVICE',
        host: '127.0.0.1',
        port: 8787,
        protocol: 'http',
        path: '/',
        capabilities: ['COMMAND_AND_CONTROL']
      }
    ];

    this.ensureStorage();
    this.load();
  }

  now() {
    return new Date().toISOString();
  }

  ensureStorage() {
    fs.mkdirSync(this.runtimeDir, { recursive: true });

    if (!fs.existsSync(this.registryPath)) {
      this.atomicWrite(this.registryPath, {
        ok: true,
        service: this.service,
        version: this.version,
        services: [],
        generatedAt: this.now()
      });
    }

    if (!fs.existsSync(this.summaryPath)) {
      this.atomicWrite(this.summaryPath, {});
    }

    if (!fs.existsSync(this.eventsPath)) {
      fs.writeFileSync(this.eventsPath, '', 'utf8');
    }
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
      const services = Array.isArray(parsed.services) ? parsed.services : [];

      for (const record of services) {
        if (record && record.id) {
          this.records.set(this.normalizeId(record.id), record);
        }
      }
    } catch {
      this.records.clear();
    }
  }

  normalizeId(value) {
    return String(value || '')
      .trim()
      .replace(/[^A-Za-z0-9_.:-]+/g, '_')
      .toUpperCase();
  }

  unique(values = []) {
    return [...new Set(values.filter(Boolean).map(value => String(value)))];
  }

  register(payload = {}) {
    const id = this.normalizeId(payload.id || payload.serviceId || payload.name);

    if (!id) {
      return {
        ok: false,
        status: 'SERVICE_ID_REQUIRED'
      };
    }

    const existing = this.records.get(id) || {};

    const record = {
      id,
      name: payload.name || existing.name || id,
      type: payload.type || existing.type || 'SERVICE',
      domain: payload.domain || existing.domain || null,
      version: payload.version || existing.version || null,
      status: payload.status || existing.status || 'REGISTERED',
      pid: payload.pid ?? existing.pid ?? null,
      host: payload.host || existing.host || null,
      port: payload.port ?? existing.port ?? null,
      protocol: payload.protocol || existing.protocol || null,
      path: payload.path || existing.path || null,
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
      healthSource: payload.healthSource || existing.healthSource || 'SELF_REGISTERED',
      source: payload.source || existing.source || 'RUNTIME_REGISTRY_API',
      startedAt: existing.startedAt || payload.startedAt || this.now(),
      registeredAt: existing.registeredAt || this.now(),
      heartbeatAt: this.now(),
      lastHealthyAt:
        payload.status === 'RUNNING' || payload.status === 'HEALTHY'
          ? this.now()
          : existing.lastHealthyAt || null,
      lastError: payload.lastError ?? existing.lastError ?? null,
      restartCount: payload.restartCount ?? existing.restartCount ?? 0,
      metadata: {
        ...(existing.metadata || {}),
        ...(payload.metadata || {})
      }
    };

    this.records.set(id, record);
    this.appendEvent('SERVICE_REGISTERED', record);
    this.persist();

    return {
      ok: true,
      status: 'SERVICE_REGISTERED',
      service: record
    };
  }

  heartbeat(id, patch = {}) {
    const normalizedId = this.normalizeId(id);
    const existing = this.records.get(normalizedId);

    if (!existing) {
      return this.register({
        id: normalizedId,
        ...patch,
        status: patch.status || 'RUNNING'
      });
    }

    const next = {
      ...existing,
      ...patch,
      id: normalizedId,
      heartbeatAt: this.now(),
      lastHealthyAt:
        patch.status === 'RUNNING' || patch.status === 'HEALTHY'
          ? this.now()
          : existing.lastHealthyAt,
      capabilities: this.unique([
        ...(existing.capabilities || []),
        ...(patch.capabilities || [])
      ])
    };

    this.records.set(normalizedId, next);
    this.appendEvent('SERVICE_HEARTBEAT', {
      id: normalizedId,
      status: next.status,
      pid: next.pid
    });
    this.persist();

    return {
      ok: true,
      status: 'HEARTBEAT_RECORDED',
      service: next
    };
  }

  deregister(id, reason = null) {
    const normalizedId = this.normalizeId(id);
    const existing = this.records.get(normalizedId);

    if (!existing) {
      return {
        ok: false,
        status: 'SERVICE_NOT_FOUND',
        id: normalizedId
      };
    }

    const next = {
      ...existing,
      status: 'DOWN',
      pid: null,
      heartbeatAt: this.now(),
      lastError: reason || existing.lastError || null
    };

    this.records.set(normalizedId, next);
    this.appendEvent('SERVICE_DEREGISTERED', {
      id: normalizedId,
      reason
    });
    this.persist();

    return {
      ok: true,
      status: 'SERVICE_DEREGISTERED',
      service: next
    };
  }

  list() {
    return [...this.records.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id) {
    return this.records.get(this.normalizeId(id)) || null;
  }

  getCapabilityProviders(capability) {
    const target = String(capability || '').toUpperCase();

    return this.list().filter(record =>
      (record.capabilities || [])
        .map(value => String(value).toUpperCase())
        .includes(target)
    );
  }

  async probeEndpoint(probe) {
    const startedAt = Date.now();
    let result;

    if (probe.protocol === 'tcp') {
      result = await this.probeTcp(probe.host, probe.port);
    } else {
      result = await this.probeHttp(probe);
    }

    const latencyMs = Date.now() - startedAt;

    return {
      ...probe,
      ...result,
      latencyMs,
      checkedAt: this.now()
    };
  }

  probeTcp(host, port) {
    return new Promise(resolve => {
      const socket = new net.Socket();
      let settled = false;

      const finish = value => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(value);
      };

      socket.setTimeout(2500);
      socket.once('connect', () => finish({ ok: true, status: 'RUNNING' }));
      socket.once('timeout', () => finish({ ok: false, status: 'DOWN', error: 'TCP timeout' }));
      socket.once('error', error =>
        finish({ ok: false, status: 'DOWN', error: error.message })
      );

      socket.connect(port, host);
    });
  }

  probeHttp(probe) {
    return new Promise(resolve => {
      const request = http.request(
        {
          host: probe.host,
          port: probe.port,
          path: probe.path || '/',
          method: 'GET',
          timeout: 3000
        },
        response => {
          response.resume();

          resolve({
            ok: true,
            status: 'RUNNING',
            httpStatus: response.statusCode
          });
        }
      );

      request.once('timeout', () => {
        request.destroy();
        resolve({
          ok: false,
          status: 'DOWN',
          error: 'HTTP timeout'
        });
      });

      request.once('error', error => {
        resolve({
          ok: false,
          status: 'DOWN',
          error: error.message
        });
      });

      request.end();
    });
  }

  async runDiscoveryCycle() {
    const configured = this.loadConfiguredProbes();
    const probes = [...this.defaultProbes, ...configured];
    const deduped = new Map();

    for (const probe of probes) {
      deduped.set(this.normalizeId(probe.id || probe.name), probe);
    }

    const results = [];

    for (const probe of deduped.values()) {
      const result = await this.probeEndpoint(probe);
      results.push(result);

      this.register({
        ...probe,
        id: this.normalizeId(probe.id || probe.name),
        status: result.status,
        healthSource: 'ACTIVE_PROBE',
        lastError: result.error || null,
        metadata: {
          ...(probe.metadata || {}),
          latencyMs: result.latencyMs,
          httpStatus: result.httpStatus || null,
          checkedAt: result.checkedAt
        }
      });
    }

    this.markStaleRecords();
    this.persist();

    return {
      ok: true,
      status: 'DISCOVERY_CYCLE_COMPLETED',
      checked: results.length,
      healthy: results.filter(item => item.ok).length,
      unhealthy: results.filter(item => !item.ok).length,
      results,
      generatedAt: this.now()
    };
  }

  loadConfiguredProbes() {
    const configPath = path.join(this.runtimeDir, 'runtime_probes.json');

    if (!fs.existsSync(configPath)) {
      this.atomicWrite(configPath, []);
      return [];
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  markStaleRecords() {
    const current = Date.now();

    for (const [id, record] of this.records.entries()) {
      if (!record.heartbeatAt) continue;

      const heartbeat = Date.parse(record.heartbeatAt);
      if (!Number.isFinite(heartbeat)) continue;

      if (
        current - heartbeat > this.staleAfterMs &&
        record.status === 'RUNNING' &&
        record.healthSource !== 'ACTIVE_PROBE'
      ) {
        this.records.set(id, {
          ...record,
          status: 'STALE'
        });
      }
    }
  }

  buildSummary() {
    const services = this.list();
    const countByStatus = {};
    const countByType = {};

    for (const record of services) {
      countByStatus[record.status] = (countByStatus[record.status] || 0) + 1;
      countByType[record.type] = (countByType[record.type] || 0) + 1;
    }

    const unhealthy = services.filter(record =>
      ['DOWN', 'ERROR', 'STALE', 'DEGRADED'].includes(record.status)
    );

    return {
      ok: unhealthy.length === 0,
      service: this.service,
      version: this.version,
      status: unhealthy.length ? 'DEGRADED' : 'HEALTHY',
      host: this.host,
      port: this.port,
      startedAt: this.startedAt,
      totalServices: services.length,
      countByStatus,
      countByType,
      unhealthyServices: unhealthy.map(record => ({
        id: record.id,
        status: record.status,
        lastError: record.lastError,
        heartbeatAt: record.heartbeatAt
      })),
      capabilityCount: this.unique(
        services.flatMap(record => record.capabilities || [])
      ).length,
      generatedAt: this.now()
    };
  }

  persist() {
    const payload = {
      ok: true,
      service: this.service,
      version: this.version,
      rootDir: this.rootDir,
      services: this.list(),
      generatedAt: this.now()
    };

    this.atomicWrite(this.registryPath, payload);
    this.atomicWrite(this.summaryPath, this.buildSummary());
  }

  appendEvent(eventType, payload) {
    fs.appendFileSync(
      this.eventsPath,
      JSON.stringify({
        eventType,
        payload,
        generatedAt: this.now()
      }) + '\n',
      'utf8'
    );
  }

  atomicWrite(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    const text = JSON.stringify(value, null, 2);

    try {
      fs.writeFileSync(tempPath, text, 'utf8');
      fs.renameSync(tempPath, filePath);
    } catch {
      try {
        fs.writeFileSync(filePath, text, 'utf8');
      } finally {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch {}
      }
    }
  }

  sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    });
    response.end(JSON.stringify(payload, null, 2));
  }

  async readJsonBody(request) {
    const chunks = [];

    for await (const chunk of request) {
      chunks.push(chunk);
    }

    if (!chunks.length) return {};

    const raw = Buffer.concat(chunks).toString('utf8');
    return JSON.parse(raw);
  }

  async handleRequest(request, response) {
    try {
      const url = new URL(request.url, `http://${this.host}:${this.port}`);

      if (request.method === 'GET' && url.pathname === '/health') {
        return this.sendJson(response, 200, this.buildSummary());
      }

      if (request.method === 'GET' && url.pathname === '/services') {
        return this.sendJson(response, 200, {
          ok: true,
          services: this.list(),
          generatedAt: this.now()
        });
      }

      if (request.method === 'GET' && url.pathname.startsWith('/services/')) {
        const id = decodeURIComponent(url.pathname.slice('/services/'.length));
        const service = this.get(id);

        return this.sendJson(
          response,
          service ? 200 : 404,
          service
            ? { ok: true, service }
            : { ok: false, status: 'SERVICE_NOT_FOUND', id }
        );
      }

      if (request.method === 'GET' && url.pathname.startsWith('/capabilities/')) {
        const capability = decodeURIComponent(
          url.pathname.slice('/capabilities/'.length)
        );

        return this.sendJson(response, 200, {
          ok: true,
          capability,
          providers: this.getCapabilityProviders(capability),
          generatedAt: this.now()
        });
      }

      if (request.method === 'POST' && url.pathname === '/register') {
        const body = await this.readJsonBody(request);
        const result = this.register(body);
        return this.sendJson(response, result.ok ? 200 : 400, result);
      }

      if (request.method === 'POST' && url.pathname.startsWith('/heartbeat/')) {
        const id = decodeURIComponent(url.pathname.slice('/heartbeat/'.length));
        const body = await this.readJsonBody(request);
        return this.sendJson(response, 200, this.heartbeat(id, body));
      }

      if (request.method === 'POST' && url.pathname.startsWith('/deregister/')) {
        const id = decodeURIComponent(url.pathname.slice('/deregister/'.length));
        const body = await this.readJsonBody(request);
        return this.sendJson(
          response,
          200,
          this.deregister(id, body.reason || null)
        );
      }

      if (request.method === 'POST' && url.pathname === '/discover') {
        const result = await this.runDiscoveryCycle();
        return this.sendJson(response, 200, result);
      }

      return this.sendJson(response, 404, {
        ok: false,
        status: 'ROUTE_NOT_FOUND',
        method: request.method,
        path: url.pathname
      });
    } catch (error) {
      return this.sendJson(response, 500, {
        ok: false,
        status: 'RUNTIME_REGISTRY_REQUEST_FAILED',
        error: error.message
      });
    }
  }

  async start() {
    if (this.server) {
      return {
        ok: true,
        status: 'ALREADY_RUNNING',
        host: this.host,
        port: this.port
      };
    }

    this.startedAt = this.now();

    this.register({
      id: this.service,
      name: 'MILES Runtime Registry Service V2',
      type: 'REGISTRY_SERVICE',
      version: this.version,
      status: 'RUNNING',
      pid: process.pid,
      host: this.host,
      port: this.port,
      protocol: 'http',
      capabilities: [
        'REGISTER_RUNTIME_SERVICE',
        'TRACK_RUNTIME_HEALTH',
        'RESOLVE_LIVE_CAPABILITY_PROVIDER',
        'DISCOVER_LOCAL_SERVICE'
      ],
      source: 'SELF'
    });

    await this.runDiscoveryCycle();

    this.server = http.createServer((request, response) =>
      this.handleRequest(request, response)
    );

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, resolve);
    });

    fs.writeFileSync(this.pidPath, String(process.pid), 'utf8');

    this.timer = setInterval(() => {
      this.runDiscoveryCycle().catch(error => {
        this.appendEvent('DISCOVERY_CYCLE_FAILED', {
          error: error.message
        });
      });
    }, this.pollIntervalMs);

    this.timer.unref();

    return {
      ok: true,
      status: 'RUNTIME_REGISTRY_STARTED',
      host: this.host,
      port: this.port,
      pid: process.pid,
      generatedAt: this.now()
    };
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.deregister(this.service, 'Service stopped.');

    if (this.server) {
      await new Promise(resolve => this.server.close(resolve));
      this.server = null;
    }

    try {
      if (fs.existsSync(this.pidPath)) fs.unlinkSync(this.pidPath);
    } catch {}

    return {
      ok: true,
      status: 'RUNTIME_REGISTRY_STOPPED',
      generatedAt: this.now()
    };
  }
}

module.exports = RuntimeRegistryService;
