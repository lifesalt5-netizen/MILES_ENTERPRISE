const builder = require("./BuilderService");
async function main(){ const action = process.argv[2] || "PROVIDER_CONTROLLERS"; const result = await builder.execute({ action }); console.log(JSON.stringify(result,null,2)); }
if(require.main === module){ main().catch(e=>{ console.error(e.stack || e.message); process.exit(1); }); }
module.exports = builder;
