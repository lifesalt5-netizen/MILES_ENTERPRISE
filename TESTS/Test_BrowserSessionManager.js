"use strict";

const browser = require("../SERVICES/Browser/BrowserSessionManager");

async function run() {

    console.log("");
    console.log("========================================");
    console.log(" MILES Browser Session Manager Test");
    console.log("========================================");
    console.log("");

    //
    // Create browser
    //
    const page = await browser.newPage("test", {
        headless: true
    });

    //
    // No external websites.
    // Test the browser itself.
    //
    await page.setContent(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>MILES Browser Test</title>
            </head>
            <body style="font-family:Arial;padding:40px;">
                <h1>MILES Browser Workforce</h1>
                <p>Browser subsystem operational.</p>
            </body>
        </html>
    `);

    const title = await page.title();

    const screenshot = await browser.screenshot(
        page,
        "browser_session_test"
    );

    const session = await browser.saveSession("test");

    await browser.shutdown();

    console.log("Title:");
    console.log(title);

    console.log("");

    console.log("Screenshot:");
    console.log(screenshot);

    console.log("");

    console.log("Session Saved:");
    console.log(session.ok);

    console.log("");

    console.log("Browser Status:");
    console.log(browser.status());

    console.log("");
    console.log("========================================");
    console.log(" Browser Session Manager Test Complete");
    console.log("========================================");
    console.log("");

}

run()
.then(() => process.exit(0))
.catch(async (err) => {

    console.error("");
    console.error("========================================");
    console.error(" Browser Session Manager FAILED");
    console.error("========================================");
    console.error(err);

    try {
        await browser.shutdown();
    } catch {}

    process.exit(1);

});