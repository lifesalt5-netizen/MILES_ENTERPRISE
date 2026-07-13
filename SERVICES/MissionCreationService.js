"use strict";

require("dotenv").config();

process.env.MILES_ROOT =
    process.env.MILES_ROOT || process.cwd();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");


const ROOT = process.env.MILES_ROOT;

const DATA =
    path.join(ROOT, "DATA", "missions");
const RUNTIME_QUEUE =
    path.join(
        ROOT,
        "DATA",
        "runtime",
        "work_queue.json"
    );

const ACTIVE_FILE =
    path.join(DATA, "active_missions.json");

const HISTORY_FILE =
    path.join(DATA, "mission_history.json");

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            return fallback;
        }

        return JSON.parse(
            fs.readFileSync(file, "utf8")
        );
    } catch {
        return fallback;
    }
}

function writeJson(file, value) {
    ensureDir(path.dirname(file));

    fs.writeFileSync(
        file,
        JSON.stringify(value, null, 2),
        "utf8"
    );
}

class MissionCreationService {

    constructor() {

        ensureDir(DATA);

    }
    readRuntimeQueue() {

    if (!fs.existsSync(RUNTIME_QUEUE)) {

        return {
            items: [],
            metadata: {}
        };

    }

    try {

        const queue =
            JSON.parse(
                fs.readFileSync(
                    RUNTIME_QUEUE,
                    "utf8"
                )
            );

        if (!Array.isArray(queue.items)) {
            queue.items = [];
        }

        return queue;

    } catch {

        return {
            items: [],
            metadata: {}
        };

    }

}

writeRuntimeQueue(queue) {

    fs.mkdirSync(
        path.dirname(RUNTIME_QUEUE),
        {
            recursive: true
        }
    );

    fs.writeFileSync(
        RUNTIME_QUEUE,
        JSON.stringify(queue, null, 2),
        "utf8"
    );

}

    create(input = {}) {

        const active =
            readJson(ACTIVE_FILE, []);

        const history =
            readJson(HISTORY_FILE, []);

        const duplicate =
            active.find(m =>
                m.worker === input.worker &&
                m.type === input.type &&
                m.targetId === input.targetId &&
                m.status !== "COMPLETED" &&
                m.status !== "FAILED"
            );

        if (duplicate) {

            return {

                ok: true,

                duplicate: true,

                mission: duplicate

            };

        }

        const mission = {

            missionId:
                crypto.randomUUID(),

            worker:
                input.worker,

            type:
                input.type,

            priority:
                Number(input.priority || 3),

            status:
                "QUEUED",

            targetId:
                input.targetId || null,

            targetName:
                input.targetName || null,

            payload:
                input.payload || {},

            reason:
                input.reason || "",

            createdAt:
                new Date().toISOString()

        };

        active.push(mission);

        history.push({

            event: "MISSION_CREATED",

            timestamp:
                new Date().toISOString(),

            missionId:
                mission.missionId

        });

        writeJson(
            ACTIVE_FILE,
            active
        );

        writeJson(
            HISTORY_FILE,
            history
        );
        const runtimeQueue =
    this.readRuntimeQueue();

const exists =
    runtimeQueue.items.find(item =>
        item.id === mission.missionId
    );

if (!exists) {

    runtimeQueue.items.push({

        id:
            mission.missionId,

        title:
            mission.targetName,

        description:
            mission.reason,

        area:
            mission.worker,

        status:
            "Queued",

        priority:
            mission.priority,

        recommendedAction:
            mission.type,

        requiresKevin:
            false,

        missionId:
            mission.missionId,

        payload:
            mission.payload

    });

    runtimeQueue.metadata = {

        ...(runtimeQueue.metadata || {}),

        updatedAt:
            new Date().toISOString()

    };

    this.writeRuntimeQueue(
        runtimeQueue
    );

}

        return {

            ok: true,

            duplicate: false,

            mission

        };

    }

    listActive() {

        return readJson(
            ACTIVE_FILE,
            []
        );

    }

    complete(id) {

        const active =
            readJson(
                ACTIVE_FILE,
                []
            );

        const history =
            readJson(
                HISTORY_FILE,
                []
            );

        const mission =
            active.find(
                m => m.missionId === id
            );

        if (!mission) {

            return {

                ok: false,

                message:
                    "Mission not found."

            };

        }

        mission.status = "COMPLETED";

        mission.completedAt =
            new Date().toISOString();

        history.push({

            event:
                "MISSION_COMPLETED",

            missionId:
                id,

            timestamp:
                mission.completedAt

        });

        writeJson(
            ACTIVE_FILE,
            active
        );

        writeJson(
            HISTORY_FILE,
            history
        );

        return {

            ok: true,

            mission

        };

    }

}

module.exports =
    new MissionCreationService();