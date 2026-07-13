const fs = require("fs");
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const config = require("./config");

function ensureParentDirectory(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function getGoogleAuthClient() {
  if (!config.credentials || !fs.existsSync(config.credentials)) {
    throw new Error(`Google OAuth credentials not found. Expected: ${config.credentials}`);
  }

  if (fs.existsSync(config.token)) {
    const tokenData = JSON.parse(fs.readFileSync(config.token, "utf8"));
    const authClient = google.auth.fromJSON(tokenData);
    authClient.scopes = config.scopes;
    return authClient;
  }

  const authClient = await authenticate({
    keyfilePath: config.credentials,
    scopes: config.scopes,
  });

  const credentials = authClient.credentials;
  if (!credentials.refresh_token) {
    throw new Error("Google did not return a refresh token. Delete google_token.json if it exists and retry, or recreate the OAuth client.");
  }

  const clientConfig = JSON.parse(fs.readFileSync(config.credentials, "utf8"));
  const keys = clientConfig.installed || clientConfig.web;

  const tokenPayload = {
    type: "authorized_user",
    client_id: keys.client_id,
    client_secret: keys.client_secret,
    refresh_token: credentials.refresh_token,
  };

  ensureParentDirectory(config.token);
  fs.writeFileSync(config.token, JSON.stringify(tokenPayload, null, 2));
  return authClient;
}

async function getUserProfile(auth) {
  const oauth2 = google.oauth2({ auth, version: "v2" });
  const profile = await oauth2.userinfo.get();
  return profile.data;
}

async function testGoogleAuth() {
  console.log("====================================");
  console.log("MILES GOOGLE AUTH TEST");
  console.log("====================================");
  console.log("Credentials:", config.credentials);
  console.log("Token:", config.token);

  const auth = await getGoogleAuthClient();
  const profile = await getUserProfile(auth);

  console.log("Authenticated as:", profile.email || "unknown");
  console.log("Google authentication successful.");
}

if (require.main === module) {
  testGoogleAuth().catch((error) => {
    console.error("Google authentication failed:");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { getGoogleAuthClient, getUserProfile };
