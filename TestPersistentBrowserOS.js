const browser = require("./CORE/BROWSER/BrowserManager");

async function main() {
    console.log("===== Persistent Browser OS =====");

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

    await new Promise(resolve => setTimeout(resolve, 8000));

    console.log(
        JSON.stringify(
            await browser.currentUrl("linkedin"),
            null,
            2
        )
    );

    console.log(
        JSON.stringify(
            await browser.screenshot("linkedin"),
            null,
            2
        )
    );

    console.log(
        JSON.stringify(
            browser.status(),
            null,
            2
        )
    );

    await browser.close();
}

main().catch(async err => {
    console.error(err);
    await browser.close();
});