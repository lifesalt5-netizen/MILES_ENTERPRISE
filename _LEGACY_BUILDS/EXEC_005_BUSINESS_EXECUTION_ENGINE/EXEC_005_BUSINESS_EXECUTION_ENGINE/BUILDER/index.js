const builder = require("./BuilderService");

async function main() {
    const action = process.argv[2] || "BUSINESS_EXECUTION_ENGINE";
    const arg = process.argv[3];
    const result = await builder.execute({ action, connector: arg });
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.stack || error.message);
        process.exit(1);
    });
}

module.exports = builder;
