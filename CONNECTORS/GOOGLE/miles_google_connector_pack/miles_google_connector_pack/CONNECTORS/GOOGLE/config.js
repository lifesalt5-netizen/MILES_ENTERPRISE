require("dotenv").config();
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "../..");

const candidateCredentialPaths = [
  process.env.GOOGLE_OAUTH_CLIENT,
  path.join(ROOT, "CONFIG", "Credentials", "google_oauth_client.json"),
  path.join(ROOT, "CONFIG", "credentials", "google_oauth_client.json"),
  path.join(ROOT, "..", "CONFIG", "Credentials", "google_oauth_client.json"),
  path.join(ROOT, "..", "CONFIG", "credentials", "google_oauth_client.json"),
].filter(Boolean);

const credentials = candidateCredentialPaths.find((p) => fs.existsSync(p)) || candidateCredentialPaths[0];
const token = process.env.GOOGLE_TOKEN_PATH || path.join(path.dirname(credentials || path.join(ROOT, "CONFIG", "Credentials")), "google_token.json");

module.exports = {
  root: ROOT,
  credentials,
  token,
  scopes: [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ],
};
