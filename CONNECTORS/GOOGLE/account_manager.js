const fs = require("fs");
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const config = require("./config");

const ACCOUNTS_ROOT = path.join(__dirname, "../../CONFIG/Credentials/google_accounts");

function safeAccountKey(email) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/@/g, "_at_")
    .replace(/[^a-z0-9_\-.]/g, "_");
}

function ensureAccountsRoot() {
  if (!fs.existsSync(ACCOUNTS_ROOT)) {
    fs.mkdirSync(ACCOUNTS_ROOT, { recursive: true });
  }
}

function getTokenPathForAccount(accountKey) {
  ensureAccountsRoot();
  const folder = path.join(ACCOUNTS_ROOT, accountKey);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, "google_token.json");
}

function listAccounts() {
  ensureAccountsRoot();
  return fs.readdirSync(ACCOUNTS_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const tokenPath = path.join(ACCOUNTS_ROOT, d.name, "google_token.json");
      let email = null;
      let valid = fs.existsSync(tokenPath);
      if (valid) {
        try {
          const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
          email = token.miles_email || null;
        } catch (_) {
          valid = false;
        }
      }
      return { accountKey: d.name, email, tokenPath, valid };
    });
}

async function getProfileEmail(auth) {
  const oauth2 = google.oauth2({ auth, version: "v2" });
  const profile = await oauth2.userinfo.get();
  return profile.data.email;
}

async function authenticateAccount(label = "default") {
  if (!fs.existsSync(config.credentials)) {
    throw new Error(`Missing Google OAuth client file: ${config.credentials}`);
  }

  const authClient = await authenticate({
    keyfilePath: config.credentials,
    scopes: config.scopes,
  });

  const email = await getProfileEmail(authClient);
  const accountKey = safeAccountKey(email || label);
  const tokenPath = getTokenPathForAccount(accountKey);

  const clientConfig = JSON.parse(fs.readFileSync(config.credentials, "utf8"));
  const keys = clientConfig.installed || clientConfig.web;

  const tokenPayload = {
    type: "authorized_user",
    client_id: keys.client_id,
    client_secret: keys.client_secret,
    refresh_token: authClient.credentials.refresh_token,
    miles_email: email,
    miles_account_key: accountKey,
    miles_created_at: new Date().toISOString(),
  };

  fs.writeFileSync(tokenPath, JSON.stringify(tokenPayload, null, 2));
  return { accountKey, email, tokenPath };
}

async function getAuthClientForAccount(accountKeyOrEmail) {
  const accountKey = accountKeyOrEmail.includes("@") ? safeAccountKey(accountKeyOrEmail) : accountKeyOrEmail;
  const tokenPath = getTokenPathForAccount(accountKey);
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`No Google token found for ${accountKeyOrEmail}. Run: node CONNECTORS\\GOOGLE\\account_manager.js add`);
  }
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  const authClient = google.auth.fromJSON(token);
  authClient.scopes = config.scopes;
  return authClient;
}

async function healthCheckAccounts() {
  const accounts = listAccounts();
  const results = [];
  for (const account of accounts) {
    try {
      const auth = await getAuthClientForAccount(account.accountKey);
      const email = await getProfileEmail(auth);
      results.push({ ...account, email, status: "OK" });
    } catch (error) {
      results.push({ ...account, status: "ERROR", error: error.message });
    }
  }
  return results;
}

async function cli() {
  const command = process.argv[2] || "list";

  if (command === "add") {
    console.log("====================================");
    console.log("MILES GOOGLE ACCOUNT ADD");
    console.log("====================================");
    const result = await authenticateAccount(process.argv[3] || "google_account");
    console.log(`Added Google account: ${result.email}`);
    console.log(`Account key: ${result.accountKey}`);
    console.log(`Token path: ${result.tokenPath}`);
    return;
  }

  if (command === "health") {
    console.log("====================================");
    console.log("MILES GOOGLE ACCOUNT HEALTH");
    console.log("====================================");
    const results = await healthCheckAccounts();
    for (const r of results) {
      console.log(`${r.status === "OK" ? "OK" : "ERROR"}: ${r.email || r.accountKey}${r.error ? ` - ${r.error}` : ""}`);
    }
    return;
  }

  console.log("====================================");
  console.log("MILES GOOGLE ACCOUNTS");
  console.log("====================================");
  const accounts = listAccounts();
  if (!accounts.length) {
    console.log("No account-specific Google tokens found yet.");
    console.log("Run: node CONNECTORS\\GOOGLE\\account_manager.js add");
    return;
  }
  for (const account of accounts) {
    console.log(`${account.valid ? "OK" : "BAD"}: ${account.email || account.accountKey}`);
  }
}

if (require.main === module) {
  cli().catch((error) => {
    console.error("Google Account Manager failed:");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  safeAccountKey,
  listAccounts,
  authenticateAccount,
  getAuthClientForAccount,
  healthCheckAccounts,
};
