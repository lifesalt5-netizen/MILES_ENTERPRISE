'use strict';

const http = require('http');

class RuntimeRegistryClient {
  constructor(options = {}) {
    this.host = options.host || process.env.MILES_RUNTIME_REGISTRY_HOST || '127.0.0.1';
    this.port = Number(options.port || process.env.MILES_RUNTIME_REGISTRY_PORT || 8791);
    this.timeoutMs = Number(options.timeoutMs || 3000);
  }

  request(method, path, payload = null) {
    return new Promise((resolve, reject) => {
      const body = payload ? JSON.stringify(payload) : null;

      const request = http.request(
        {
          host: this.host,
          port: this.port,
          method,
          path,
          timeout: this.timeoutMs,
          headers: body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
              }
            : {}
        },
        response => {
          const chunks = [];

          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');

            try {
              resolve(JSON.parse(raw));
            } catch {
              resolve({
                ok: false,
                status: 'INVALID_REGISTRY_RESPONSE',
                httpStatus: response.statusCode,
                raw
              });
            }
          });
        }
      );

      request.once('timeout', () => {
        request.destroy(new Error('Runtime Registry request timed out.'));
      });

      request.once('error', reject);

      if (body) request.write(body);
      request.end();
    });
  }

  register(payload) {
    return this.request('POST', '/register', payload);
  }

  heartbeat(id, patch = {}) {
    return this.request(
      'POST',
      `/heartbeat/${encodeURIComponent(id)}`,
      patch
    );
  }

  deregister(id, reason = null) {
    return this.request(
      'POST',
      `/deregister/${encodeURIComponent(id)}`,
      { reason }
    );
  }

  health() {
    return this.request('GET', '/health');
  }

  services() {
    return this.request('GET', '/services');
  }

  providers(capability) {
    return this.request(
      'GET',
      `/capabilities/${encodeURIComponent(capability)}`
    );
  }
}

module.exports = RuntimeRegistryClient;
