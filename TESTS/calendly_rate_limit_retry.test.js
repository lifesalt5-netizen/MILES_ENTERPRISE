'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const connectorPath = path.join(__dirname, '..', 'CONNECTORS', 'CALENDLY', 'connector.js');
const src = fs.readFileSync(connectorPath, 'utf8');
const connector = require(connectorPath);

assert(src.includes('response.status === 429'));
assert(src.includes("headers?.get?.('retry-after')"));
assert(src.includes('MILES_CALENDLY_429_RETRIES'));
assert(src.includes('MILES_CALENDLY_429_DELAY_MS'));
assert(src.includes('MILES_CALENDLY_429_MAX_DELAY_MS'));
assert(connector.MAX_RATE_LIMIT_RETRIES >= 1);
assert(connector.DEFAULT_RATE_LIMIT_DELAY_MS >= 250);
assert(connector.MAX_RATE_LIMIT_DELAY_MS >= connector.DEFAULT_RATE_LIMIT_DELAY_MS);

const retryAfterSeconds = connector.retryDelayMs({ headers: { get: () => '2' } }, 0);
assert.strictEqual(retryAfterSeconds, 2000);
const fallback = connector.retryDelayMs({ headers: { get: () => null } }, 1);
assert(fallback >= connector.DEFAULT_RATE_LIMIT_DELAY_MS);
assert(fallback <= connector.MAX_RATE_LIMIT_DELAY_MS);

console.log('CALENDLY_RATE_LIMIT_RETRY=PASS');
