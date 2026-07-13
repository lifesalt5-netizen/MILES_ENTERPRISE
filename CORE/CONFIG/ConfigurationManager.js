const fs = require("fs");
const path = require("path");
require("dotenv").config();

function getEnv(key, fallback = null) {
    return process.env[key] || fallback;
}

function requireEnv(key) {
    const value = process.env[key];

    if (!value) {
        return {
            ok: false,
            key: key,
            reason: "Missing required env: " + key
        };
    }

    return {
        ok: true,
        key: key,
        value: value
    };
}

function getConfigHealth() {
    const required = ["ORION_DB_PATH"];
    const optional = ["INSTANTLY_API_KEY"];

    return {
        envExists: fs.existsSync(path.join(process.cwd(), ".env")),
        required: required.map(requireEnv),
        optional: optional.map(function (k) {
            return {
                key: k,
                present: Boolean(process.env[k])
            };
        }),
        failSoft: getEnv("MILES_FAIL_SOFT", "true") === "true"
    };
}

module.exports = {
    getEnv,
    requireEnv,
    getConfigHealth
};