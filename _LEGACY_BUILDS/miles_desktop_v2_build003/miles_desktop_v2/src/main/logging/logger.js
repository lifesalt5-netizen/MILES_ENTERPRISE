"use strict";

const path = require("path");
const { Logger } = require("./logger");

const ROOT =
    process.env.MILES_ROOT ||
    path.resolve(__dirname, "..");

module.exports = new Logger(ROOT);