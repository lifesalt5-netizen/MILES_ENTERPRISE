const browser = require("./CORE/BROWSER/BrowserManager");

async function main() {
    console.log("");
    console.log("====================================");
    console.log("MILES AUTOMATION BROWSER");
    console.log("====================================");
    console.log("");

    const system = process.argv[2] || "linkedin";

    console.log(
        JSON.stringify(
            await browser.openKnownSystem(system, { headless: false }),
            null,
            2
        )
    );

    console.log("");
    console.log("Browser opened using dedicated MILES profile.");
    console.log("Log in manually if needed.");
    console.log("When finished, close the browser window or press CTRL+C.");
    console.log("");

    process.on("SIGINT", async () => {
        await browser.close();
        process.exit(0);
    });
}

main().catch(async err => {
    console.error(err);
    await browser.close();
    process.exit(1);
});