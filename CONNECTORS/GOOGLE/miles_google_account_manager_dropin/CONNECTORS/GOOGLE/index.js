const { getGoogleAuthClient } = require("./auth");
const gmail = require("./gmail");
const calendar = require("./calendar");
const drive = require("./drive");
const contacts = require("./contacts");
const accountManager = require("./account_manager");
const workspace = require("./workspace");

async function healthCheck() {
  const accounts = await accountManager.healthCheckAccounts();
  const ok = accounts.length > 0 && accounts.every(a => a.status === "OK");
  return {
    service: "GOOGLE",
    status: ok ? "OK" : "WARN",
    message: ok ? "Google Workspace authenticated" : "Google OAuth exists, but no healthy account-specific tokens found",
    accounts,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  getGoogleAuthClient,
  gmail,
  calendar,
  drive,
  contacts,
  accountManager,
  workspace,
  healthCheck,
};
