const fs = require("fs");
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const config = require("./config");

async function getGoogleAuthClient() {
    if (!fs.existsSync(config.credentials)) {
        throw new Error(`Google OAuth credentials not found: ${config.credentials}`);
    }

    let authClient;

    if (fs.existsSync(config.token)) {
        const tokenData = JSON.parse(fs.readFileSync(config.token, "utf8"));
        authClient = google.auth.fromJSON(tokenData);
        authClient.scopes = config.scopes;
        return authClient;
    }

    authClient = await authenticate({
        keyfilePath: config.credentials,
        scopes: config.scopes
    });

    const credentials = authClient.credentials;

    const clientConfig = JSON.parse(fs.readFileSync(config.credentials, "utf8"));
    const keys = clientConfig.installed || clientConfig.web;

    const tokenPayload = {
        type: "authorized_user",
        client_id: keys.client_id,
        client_secret: keys.client_secret,
        refresh_token: credentials.refresh_token
    };

    fs.writeFileSync(config.token, JSON.stringify(tokenPayload, null, 2));

    return authClient;
}

async function testGoogleAuth() {
    console.log("====================================");
    console.log("MILES GOOGLE AUTH TEST");
    console.log("====================================");

    const auth = await getGoogleAuthClient();

    const oauth2 = google.oauth2({
        auth,
        version: "v2"
    });

    const profile = await oauth2.userinfo.get();

    console.log("Authenticated as:", profile.data.email);
    console.log("Google authentication successful.");
}

if (require.main === module) {
    testGoogleAuth().catch((error) => {
        console.error("Google authentication failed:");
        console.error(error.message);
        process.exit(1);
    });
}

module.exports = {
    getGoogleAuthClient
};