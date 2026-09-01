"use strict";
const assert = require("assert");
const { canonicalIdentity } = require("../SERVICES/revenue/AwardedUniverseCoverageService");
assert.deepStrictEqual(canonicalIdentity({recipient_uei:"abc123",recipient_name:"Acme Inc"},"PRIME_AWARD"), {key:"UEI:ABC123",uei:"ABC123",name:"ACME INC",authority:"UEI"});
assert.deepStrictEqual(canonicalIdentity({"Sub-Recipient UEI":"sub999","Sub-Awardee Name":"Sub Co"},"SUBAWARD"), {key:"UEI:SUB999",uei:"SUB999",name:"SUB CO",authority:"UEI"});
assert.deepStrictEqual(canonicalIdentity({"Sub-Awardee Name":"Name Only LLC"},"SUBAWARD"), {key:"NAME:NAME ONLY LLC",uei:null,name:"NAME ONLY LLC",authority:"NORMALIZED_LEGAL_NAME_FALLBACK"});
assert.strictEqual(canonicalIdentity({},"PRIME_AWARD"), null);
console.log("AWARDED_UNIVERSE_COVERAGE_IDENTITY_TEST: GREEN");
