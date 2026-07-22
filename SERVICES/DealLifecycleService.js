"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");

const DEFAULT_DEALS_FILE =
    process.env.MILES_DEALS_FILE ||
    path.join(
        ROOT,
        "DATA",
        "runtime",
        "latest_deals.json"
    );

function ensureDirectory(filePath) {
    fs.mkdirSync(
        path.dirname(filePath),
        { recursive: true }
    );
}

function readJson(filePath, fallback = []) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }

        const parsed = JSON.parse(
            fs.readFileSync(filePath, "utf8")
        );

        if (Array.isArray(parsed)) {
            return parsed;
        }

        if (Array.isArray(parsed.deals)) {
            return parsed.deals;
        }

        if (
            parsed.business &&
            Array.isArray(parsed.business.deals)
        ) {
            return parsed.business.deals;
        }

        return fallback;
    } catch (error) {
        console.error(
            "[DEAL LIFECYCLE] Unable to read deals:",
            error.message
        );

        return fallback;
    }
}

function writeJsonAtomic(filePath, value) {
    ensureDirectory(filePath);

    const temporary =
        `${filePath}.${process.pid}.${Date.now()}.tmp`;

    fs.writeFileSync(
        temporary,
        JSON.stringify(value, null, 2),
        "utf8"
    );

    try {
        fs.renameSync(
            temporary,
            filePath
        );
    } catch (renameError) {
        fs.copyFileSync(
            temporary,
            filePath
        );

        fs.unlinkSync(temporary);
    }
}

function firstDefined(...values) {
    return values.find(
        value =>
            value !== undefined &&
            value !== null &&
            value !== ""
    );
}

function normalizeText(value) {
    return String(value || "")
        .trim();
}

function normalizeEmail(value) {
    return normalizeText(value)
        .toLowerCase();
}

function normalizeProbability(value, fallback = 0.25) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    if (numeric > 1 && numeric <= 100) {
        return numeric / 100;
    }

    return Math.max(
        0,
        Math.min(1, numeric)
    );
}

function normalizeValue(value) {
    const numeric = Number(
        String(value ?? "")
            .replace(/[$,\s]/g, "")
    );

    return Number.isFinite(numeric)
        ? numeric
        : 0;
}

function buildDeterministicId(record = {}) {
    const sourceIdentity = [
        firstDefined(
            record.id,
            record.leadId,
            record.replyId,
            record.opportunityId,
            record.proposalId,
            ""
        ),
        firstDefined(
            record.email,
            record.contactEmail,
            record.from,
            ""
        ),
        firstDefined(
            record.company,
            record.companyName,
            record.organization,
            record.name,
            ""
        )
    ]
        .map(normalizeText)
        .join("::")
        .toLowerCase();

    if (sourceIdentity.replace(/:/g, "")) {
        return `DEAL-${crypto
            .createHash("sha256")
            .update(sourceIdentity)
            .digest("hex")
            .slice(0, 16)
            .toUpperCase()}`;
    }

    return `DEAL-${crypto
        .randomUUID()
        .replace(/-/g, "")
        .slice(0, 16)
        .toUpperCase()}`;
}

function inferStage(record = {}) {
    const explicit = normalizeText(
        firstDefined(
            record.stage,
            record.dealStage,
            record.pipelineStage,
            record.status
        )
    );

    if (explicit) {
        return explicit;
    }

    if (
        record.proposalId ||
        record.proposalSent ||
        record.proposalSubmitted
    ) {
        return "PROPOSAL";
    }

    return "QUALIFIED";
}

function inferUrgency(record = {}) {
    const explicit = normalizeText(
        record.urgency
    ).toLowerCase();

    if (
        ["high", "medium", "low"].includes(
            explicit
        )
    ) {
        return explicit;
    }

    const score = Number(
        firstDefined(
            record.score,
            record.qualificationScore,
            record.fitScore,
            0
        )
    );

    if (score >= 80) {
        return "high";
    }

    if (score >= 60) {
        return "medium";
    }

    return "low";
}

class DealLifecycleService {
    constructor(options = {}) {
        this.dealsFile =
            options.dealsFile ||
            DEFAULT_DEALS_FILE;
    }

    getDeals() {
        return readJson(
            this.dealsFile,
            []
        );
    }

    normalizeCandidate(candidate = {}) {
        const now =
            new Date().toISOString();

        const company =
            normalizeText(
                firstDefined(
                    candidate.company,
                    candidate.companyName,
                    candidate.organization,
                    candidate.accountName,
                    candidate.name,
                    "Unknown"
                )
            );

        const contactName =
            normalizeText(
                firstDefined(
                    candidate.contactName,
                    candidate.fullName,
                    candidate.person,
                    candidate.leadName,
                    ""
                )
            );

        const email =
            normalizeEmail(
                firstDefined(
                    candidate.email,
                    candidate.contactEmail,
                    candidate.from,
                    candidate.senderEmail,
                    ""
                )
            );

        const value =
            normalizeValue(
                firstDefined(
                    candidate.value,
                    candidate.amount,
                    candidate.estimatedValue,
                    candidate.opportunityValue,
                    candidate.contractValue,
                    0
                )
            );

        const probability =
            normalizeProbability(
                firstDefined(
                    candidate.probability,
                    candidate.winProbability,
                    candidate.closeProbability,
                    0.25
                )
            );

        const engagement =
            Number(
                firstDefined(
                    candidate.engagement,
                    candidate.engagementScore,
                    candidate.replyScore,
                    0
                )
            ) || 0;

        return {
            ...candidate,

            id:
                normalizeText(candidate.id) ||
                buildDeterministicId(candidate),

            type: "DEAL",

            name:
                normalizeText(
                    firstDefined(
                        candidate.dealName,
                        candidate.name,
                        company
                    )
                ) || company,

            company,
            contactName,
            email,

            stage:
                inferStage(candidate),

            status:
                normalizeText(
                    firstDefined(
                        candidate.status,
                        "ACTIVE"
                    )
                ),

            value,
            probability,
            weightedValue:
                value * probability,

            score:
                Number(
                    firstDefined(
                        candidate.score,
                        candidate.qualificationScore,
                        candidate.fitScore,
                        50
                    )
                ) || 50,

            engagement,
            urgency:
                inferUrgency(candidate),

            source:
                normalizeText(
                    firstDefined(
                        candidate.source,
                        candidate.provider,
                        candidate.channel,
                        "REVENUE_RESULT"
                    )
                ),

            sourceLeadId:
                firstDefined(
                    candidate.leadId,
                    candidate.sourceLeadId,
                    null
                ),

            sourceReplyId:
                firstDefined(
                    candidate.replyId,
                    candidate.sourceReplyId,
                    null
                ),

            opportunityId:
                firstDefined(
                    candidate.opportunityId,
                    null
                ),

            proposalId:
                firstDefined(
                    candidate.proposalId,
                    null
                ),

            createdAt:
                firstDefined(
                    candidate.createdAt,
                    now
                ),

            updatedAt: now,

            lastActivity:
                firstDefined(
                    candidate.lastActivity,
                    candidate.updatedAt,
                    candidate.lastUpdated,
                    now
                )
        };
    }

    findExistingIndex(deals, candidate) {
        const candidateId =
            normalizeText(candidate.id);

        const candidateEmail =
            normalizeEmail(candidate.email);

        const candidateCompany =
            normalizeText(candidate.company)
                .toLowerCase();

        return deals.findIndex(deal => {
            if (
                candidateId &&
                normalizeText(deal.id) === candidateId
            ) {
                return true;
            }

            if (
                candidate.sourceLeadId &&
                deal.sourceLeadId ===
                    candidate.sourceLeadId
            ) {
                return true;
            }

            if (
                candidate.sourceReplyId &&
                deal.sourceReplyId ===
                    candidate.sourceReplyId
            ) {
                return true;
            }

            if (
                candidate.opportunityId &&
                deal.opportunityId ===
                    candidate.opportunityId
            ) {
                return true;
            }

            return Boolean(
                candidateEmail &&
                candidateCompany &&
                normalizeEmail(deal.email) ===
                    candidateEmail &&
                normalizeText(deal.company)
                    .toLowerCase() ===
                    candidateCompany
            );
        });
    }

    upsert(candidate = {}) {
        const deals =
            this.getDeals();

        const normalized =
            this.normalizeCandidate(candidate);

        const existingIndex =
            this.findExistingIndex(
                deals,
                normalized
            );

        let operation;

        if (existingIndex >= 0) {
            const existing =
                deals[existingIndex];

            deals[existingIndex] = {
                ...existing,
                ...normalized,

                id:
                    existing.id ||
                    normalized.id,

                createdAt:
                    existing.createdAt ||
                    normalized.createdAt,

                updatedAt:
                    new Date().toISOString()
            };

            operation = "UPDATED";
        } else {
            deals.push(normalized);
            operation = "CREATED";
        }

        this.persist(deals);

        const deal =
            existingIndex >= 0
                ? deals[existingIndex]
                : deals[deals.length - 1];

        return {
            operation,
            deal
        };
    }

    upsertMany(candidates = []) {
        const input =
            Array.isArray(candidates)
                ? candidates
                : [];

        const results =
            input.map(candidate =>
                this.upsert(candidate)
            );

        return {
            ok: true,
            processed: input.length,
            created:
                results.filter(
                    result =>
                        result.operation ===
                        "CREATED"
                ).length,
            updated:
                results.filter(
                    result =>
                        result.operation ===
                        "UPDATED"
                ).length,
            deals:
                results.map(
                    result => result.deal
                ),
            totalDeals:
                this.getDeals().length,
            dealsFile:
                this.dealsFile
        };
    }

    updateStage(dealId, stage, updates = {}) {
        const deals =
            this.getDeals();

        const index =
            deals.findIndex(
                deal =>
                    String(deal.id) ===
                    String(dealId)
            );

        if (index < 0) {
            return {
                ok: false,
                error:
                    `Deal not found: ${dealId}`
            };
        }

        deals[index] = {
            ...deals[index],
            ...updates,
            stage,
            updatedAt:
                new Date().toISOString(),
            lastActivity:
                new Date().toISOString()
        };

        this.persist(deals);

        return {
            ok: true,
            deal:
                deals[index]
        };
    }

    persist(deals = []) {
        const payload = {
            ok: true,
            type:
                "MILES_AUTHORITATIVE_DEAL_STATE",
            generatedAt:
                new Date().toISOString(),
            count:
                deals.length,
            deals
        };

        writeJsonAtomic(
            this.dealsFile,
            payload
        );

        return payload;
    }
}

module.exports =
    DealLifecycleService;
