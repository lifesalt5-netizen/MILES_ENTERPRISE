require("dotenv").config();

const path = require("path");

module.exports = {
    credentials: path.join(
        __dirname,
        "../../CONFIG/Credentials/google_oauth_client.json"
    ),

    token: path.join(
        __dirname,
        "../../CONFIG/Credentials/google_token.json"
    ),

    scopes: [
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/contacts",
        "https://www.googleapis.com/auth/userinfo.email"
    ]
};