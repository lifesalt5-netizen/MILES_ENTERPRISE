const worker = require("./CORE/BROWSER/BrowserWorker");

async function main() {
    const system = process.argv[2] || "instantly";

    console.log("");
    console.log("===== MILES BROWSER WORKER TEST =====");
    console.log("System:", system);
    console.log("");

    const result = await worker.inspect(system);

    console.log(JSON.stringify(result, null, 2));

    console.log("");
    console.log("Leaving browser open for 10 seconds...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    await worker.close();
}

main().catch(async err => {
    console.error(err);
    await worker.close();
});