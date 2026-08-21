"use strict";

const path = require("path");
const LeadSupplyChainCloseoutService = require("../SERVICES/revenue/LeadSupplyChainCloseoutService");

function parse(argv) {
  const arg = name => {
    const hit = argv.find(v => v.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  return {
    apply: argv.includes("--apply"),
    rootDir: arg("root"),
    intelligenceRoot: arg("intelligence-root"),
    masterPath: arg("master"),
    legacyRoot: arg("legacy-root"),
    sledMasterPath: arg("sled-master"),
    outputRoot: arg("output-root")
  };
}

async function main() {
  const input = parse(process.argv.slice(2));
  const service = new LeadSupplyChainCloseoutService({
    rootDir: input.rootDir ? path.resolve(input.rootDir) : undefined,
    intelligenceRoot: input.intelligenceRoot || undefined,
    masterPath: input.masterPath || undefined,
    legacyRoot: input.legacyRoot || undefined,
    sledMasterPath: input.sledMasterPath || undefined,
    outputRoot: input.outputRoot || undefined
  });
  const result = await service.run({ apply: input.apply });
  console.log(JSON.stringify(result, null, 2));
  if (input.apply && result.ok !== true) process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { parse, main };
