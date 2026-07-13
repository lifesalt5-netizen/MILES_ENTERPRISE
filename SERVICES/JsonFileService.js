"use strict";

const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function exists(file) {
    return fs.existsSync(file);
}

function readJson(file, fallback = null) {
    try {
        if (!exists(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function readJsonStrict(file) {
    if (!exists(file)) {
        const error = new Error(`File not found: ${file}`);
        error.code = "ENOENT";
        throw error;
    }

    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function appendJsonArray(file, record, max = 500) {
    const existing = readJson(file, []);
    const array = Array.isArray(existing) ? existing : [];
    array.push(record);
    writeJson(file, array.slice(-max));
}

module.exports = {
    ensureDir,
    exists,
    readJson,
    readJsonStrict,
    writeJson,
    appendJsonArray
};
