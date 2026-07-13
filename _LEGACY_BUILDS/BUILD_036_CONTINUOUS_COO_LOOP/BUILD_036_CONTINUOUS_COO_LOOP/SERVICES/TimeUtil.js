"use strict";

function pad(value) {
    return String(value).padStart(2, "0");
}

function nowIso() {
    return new Date().toISOString();
}

function timestampForFile(date = new Date()) {
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join("") + "_" + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join("");
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    nowIso,
    timestampForFile,
    sleep
};
