require("dotenv").config();
const path = require("path");

const root = path.resolve(__dirname, "../..");

module.exports = {
  credentials: process.env.GOOGLE_OAUTH_CLIENT || path.join(root, "CONFIG", "Credentials", "google_oauth_client.json"),
  token: process.env.GOOGLE_TOKEN_PATH || path.join(root, "CONFIG", "Credentials", "google_token.json"),
  scopes: [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ]
};
