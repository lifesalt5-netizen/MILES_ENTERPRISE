const builder = require("./BuilderService");
async function main() {
  const action = process.argv[2] || "CONTROLLED_WRITE";
  const provider = process.argv[3] || "instantly";
  const operation = process.argv[4] || "CREATE_TEST_CAMPAIGN";
  const result = await builder.execute({ action, provider, operation, payload: { name: `MILES_TEST_${Date.now()}` } });
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
module.exports = builder;
