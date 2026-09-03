'use strict';

const assert = require('assert');
const { helpers } = require('../SERVICES/demo/SamQualifiedProspectNameResolver');

assert.strictEqual(helpers.canonicalCompact('DeLune Corporation'), 'DELUNE');
assert.strictEqual(helpers.canonicalCompact('DE LUNE CORP'), 'DELUNE');
assert.strictEqual(helpers.canonicalCompact('De Lune, Corp.'), 'DELUNE');
assert.strictEqual(helpers.canonicalCompact('AcmeTechnologies LLC'), 'ACMETECHNOLOGIES');
assert.strictEqual(helpers.canonicalCompact('ACME TECHNOLOGIES, L.L.C.'), 'ACMETECHNOLOGIESLLC');
assert.strictEqual(helpers.canonical('Example Incorporated'), 'EXAMPLE');
assert.strictEqual(helpers.canonical('Example Inc'), 'EXAMPLE');
assert.strictEqual(helpers.canonical('Example Corporation'), 'EXAMPLE');
assert.strictEqual(helpers.canonical('Example Corp'), 'EXAMPLE');

console.log('SAM_QUALIFIED_PROSPECT_NAME_RESOLVER_TEST: GREEN');
