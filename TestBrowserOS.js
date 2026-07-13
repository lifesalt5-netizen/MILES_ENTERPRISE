const browser = require("./CORE/BROWSER/BrowserManager");
const sessions = require("./CORE/BROWSER/SessionManager");

async function main() {
    console.log("===== Browser Sessions =====");
    console.log(JSON.stringify(sessions.status(), null, 2));

    console.log("===== Open LinkedIn =====");
    console.log(
        JSON.stringify(
            await browser.openSystem(
                "linkedin",
                "https://www.linkedin.com/feed/",
                { headless: false }
            ),
            null,
            2
        )
    );

    console.log("Manually confirm LinkedIn is logged in.");
    console.log("Waiting 15 seconds before saving session...");

    await new Promise(resolve => setTimeout(resolve, 15000));

    console.log("===== Save LinkedIn Session =====");
    console.log(JSON.stringify(await browser.saveSession("linkedin"), null, 2));

    console.log("===== Screenshot =====");
    console.log(JSON.stringify(await browser.screenshot("linkedin"), null, 2));

    console.log("===== Browser Status =====");
    console.log(JSON.stringify(browser.status(), null, 2));

    await browser.close();
}

main().catch(async err => {
    console.error(err);
    await browser.close();
});