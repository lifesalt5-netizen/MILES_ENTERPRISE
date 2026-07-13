const fs = require("fs");
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const config = require("./config");

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function getGoogleAuthClient() {
  if (!fs.existsSync(config.credentials)) {
    throw new Error(`Google OAuth credentials not found: ${config.credentials}`);
  }

  if (fs.existsSync(config.token)) {
    const tokenData = JSON.parse(fs.readFileSync(config.token, "utf8"));
    const authClient = google.auth.fromJSON(tokenData);
    authClient.scopes = config.scopes;
    return authClient;
  }

  const authClient = await authenticate({
    keyfilePath: config.credentials,
    scopes: config.scopes
  });

  const clientConfig = JSON.parse(fs.readFileSync(config.credentials, "utf8"));
  const keys = clientConfig.installed || clientConfig.web;

  if (!authClient.credentials.refresh_token) {
    throw new Error("Google did not return a refresh token. Delete google_token.json if present and re-authorize.");
  }

  const tokenPayload = {
    type: "authorized_user",
    client_id: keys.client_id,
    client_secret: keys.client_secret,
    refresh_token: authClient.credentials.refresh_token
  };

  ensureDir(config.token);
  fs.writeFileSync(config.token, JSON.stringify(tokenPayload, null, 2));
  return authClient;
}

async function testGoogleAuth() {
  console.log("====================================");
  console.log("MILES GOOGLE AUTH TEST");
  console.log("====================================");
  console.log("Credentials:", config.credentials);
  console.log("Token:", config.token);

  const auth = await getGoogleAuthClient();
  const oauth2 = google.oauth2({ auth, version: "v2" });
  const profile = await oauth2.userinfo.get();

  console.log("Authenticated as:", profile.data.email || "unknown");
  console.log("Google authentication successful.");
}

if (require.main === module) {
  testGoogleAuth().catch((error) => {
    console.error("Google authentication failed:");
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { getGoogleAuthClient };
