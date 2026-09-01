"use strict";

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined || value === "") return [];

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
            return [value];
        }
    }

    return [value];
}

function normalizeText(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function toDateOnly(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
}

function splitTilde(value) {
    return String(value || "")
        .split("~")
        .map(item => item.trim())
        .filter(Boolean);
}

function isProspectOpportunity(row = {}, asOfDate) {
    const source = String(row.source || "").toUpperCase();
    const status = String(row.status || "").toUpperCase();
    const title = String(row.title || "").trim();
    const dueDate = toDateOnly(row.due_date);

    if (!title || title.toUpperCase() === "NOT APPLICABLE") return false;
    if (source.includes("SAM_REGISTRY") || source.includes("CONTRACT_AWARDS")) return false;

    const isForecast = source.includes("FORECAST");
    const isOpportunitySource =
        source.includes("OPPORTUNITY") ||
        source.includes("SAM.GOV") ||
        source.includes("SOURCES_SOUGHT") ||
        source.includes("RFI") ||
        source.includes("RFQ") ||
        source.includes("RFP") ||
        isForecast;

    const looksOpen =
        status.includes("OPEN") ||
        status.includes("SOURCE IDENTIFIED") ||
        isForecast;

    if (!isOpportunitySource || !looksOpen) return false;
    if (dueDate && dueDate < asOfDate) return false;
    if (!dueDate && !isForecast) return false;

    return true;
}

function normalizeRecompete(row = {}, asOfDate) {
    const date = toDateOnly(row.recompete_date);
    if (date && date < asOfDate) return null;

    const title = String(row.title || "");
    const monitoringProfile = /^Recompete monitoring profile for /i.test(title);

    return {
        ...row,
        signalType: monitoringProfile ? "MONITORING_PROFILE" : "ORION_RECOMPETE_SIGNAL",
        prospectClaim: monitoringProfile
            ? "Modeled monitoring signal; not a confirmed procurement event."
            : "ORION recompete signal; validate against an authoritative procurement source before external claim."
    };
}

class ProspectGrowthAssessmentService {
    constructor(options = {}) {
        this.orion = options.orion || null;
        this.samIdentity = options.samIdentityService || null;
    }

    getOrion() {
        if (!this.orion) {
            this.orion = require("../../CONNECTORS/ORION/connector");
        }

        return this.orion;
    }

    getSamIdentity() {
        if (!this.samIdentity) {
            const SamQualifiedIdentityService = require("../orion/SamQualifiedIdentityService");
            this.samIdentity = new SamQualifiedIdentityService();
        }
        return this.samIdentity;
    }

    selectContractor(term, candidates = []) {
        if (!Array.isArray(candidates) || candidates.length === 0) {
            return null;
        }

        const raw = String(term || "").trim();
        const normalized = normalizeText(raw);

        const exactUei = candidates.find(
            (row) => String(row?.uei || "").trim().toUpperCase() === raw.toUpperCase()
        );

        if (exactUei) return exactUei;

        const exactCompany = candidates.find(
            (row) =>
                normalizeText(row?.company) === normalized ||
                normalizeText(row?.company_norm) === normalized
        );

        return exactCompany || candidates[0];
    }

    currentSamIdentity(searchTerm, contractor = null) {
        const service = this.getSamIdentity();
        const attempts = [];
        if (contractor?.uei) attempts.push(contractor.uei);
        if (contractor?.company) attempts.push(contractor.company);
        attempts.push(searchTerm);
        const seen = new Set();
        let last = null;
        for (const term of attempts) {
            const key = String(term || "").trim().toUpperCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            const result = service.lookup(term);
            last = result;
            if (result?.ok && result.record) return result;
        }
        return last || { ok: false, status: "SAM_QUALIFIED_UNIVERSE_UNAVAILABLE", record: null, candidates: [] };
    }

    build(term, options = {}) {
        const searchTerm = String(term || "").trim();

        if (!searchTerm) {
            return {
                ok: false,
                service: "PROSPECT_GROWTH_ASSESSMENT",
                status: "TERM_REQUIRED",
                readOnly: true
            };
        }

        const orion = this.getOrion();
        const init = orion.initialize();
        let candidates = [];
        if (init?.ok) {
            candidates = orion.searchContractors(
                searchTerm,
                Math.max(1, Math.min(Number(options.searchLimit) || 10, 50))
            );
        }

        const contractor = this.selectContractor(searchTerm, candidates);
        const samResult = this.currentSamIdentity(searchTerm, contractor);
        const sam = samResult?.ok ? samResult.record : null;

        if (!contractor && !sam) {
            return {
                ok: false,
                service: "PROSPECT_GROWTH_ASSESSMENT",
                status: init?.ok ? "CONTRACTOR_NOT_FOUND" : "ORION_AND_SAM_IDENTITY_UNAVAILABLE",
                term: searchTerm,
                candidates: [],
                identityEvidence: {
                    orionAvailable: init?.ok === true,
                    samQualifiedStatus: samResult?.status || null,
                    samQualifiedEvidence: samResult?.evidence || null
                },
                readOnly: true
            };
        }

        const contractorId = contractor?.id ?? null;
        const detailLimit = Math.max(1, Math.min(Number(options.detailLimit) || 25, 100));
        const rawDetailLimit = Math.max(detailLimit, Math.min(Number(options.rawDetailLimit) || 100, 250));
        const asOfDate = toDateOnly(options.asOfDate || new Date()) || new Date().toISOString().slice(0, 10);
        const linkedOrionAvailable = init?.ok === true && contractorId != null;

        const recommendationRows = linkedOrionAvailable ? orion.query(
            "SELECT * FROM contractor_recommendations_v2 WHERE contractor_id = ? LIMIT 1",
            [contractorId]
        ) : [];

        const personaRows = linkedOrionAvailable ? orion.query(
            "SELECT * FROM persona_scores WHERE contractor_id = ? LIMIT 1",
            [contractorId]
        ) : [];

        const buyers = linkedOrionAvailable ? orion.query(
            "SELECT * FROM buyers WHERE company_id = ? ORDER BY spend DESC, award_count DESC LIMIT ?",
            [contractorId, detailLimit]
        ) : [];

        const rawOpportunities = linkedOrionAvailable ? orion.query(
            "SELECT * FROM opportunities WHERE company_id = ? ORDER BY CASE WHEN due_date = '' OR due_date IS NULL THEN 1 ELSE 0 END, due_date ASC LIMIT ?",
            [contractorId, rawDetailLimit]
        ) : [];

        const rawRecompetes = linkedOrionAvailable ? orion.query(
            "SELECT * FROM recompetes WHERE company_id = ? ORDER BY CASE WHEN recompete_date = '' OR recompete_date IS NULL THEN 1 ELSE 0 END, recompete_date ASC LIMIT ?",
            [contractorId, rawDetailLimit]
        ) : [];

        const opportunities = rawOpportunities
            .filter((row) => isProspectOpportunity(row, asOfDate))
            .slice(0, detailLimit);

        const recompetes = rawRecompetes
            .map((row) => normalizeRecompete(row, asOfDate))
            .filter(Boolean)
            .slice(0, detailLimit);

        const recommendation = recommendationRows[0] || null;
        const persona = personaRows[0] || null;

        const recommendations = recommendation
            ? {
                topPriorityActions: parseJsonArray(recommendation.top_priority_actions),
                vehicle: parseJsonArray(recommendation.vehicle_recommendations),
                certification: parseJsonArray(recommendation.certification_recommendations),
                buyer: parseJsonArray(recommendation.buyer_recommendations),
                opportunity: parseJsonArray(recommendation.opportunity_recommendations),
                partner: parseJsonArray(recommendation.partner_recommendations),
                growth: parseJsonArray(recommendation.growth_recommendations),
                lastUpdated: recommendation.last_updated || null
            }
            : {
                topPriorityActions: [],
                vehicle: [],
                certification: [],
                buyer: [],
                opportunity: [],
                partner: [],
                growth: [],
                lastUpdated: null
            };

        const warnings = [];
        if (!linkedOrionAvailable) {
            warnings.push("Identity is confirmed from the current qualified SAM universe, but this company has no linked ORION contractor row; ORION buyer/opportunity/recompete/persona joins are explicitly unavailable.");
        }
        if (buyers.length === 0) {
            warnings.push("No linked buyer history is available for this contractor.");
        }
        if (opportunities.length === 0) {
            warnings.push("No current prospect-safe linked opportunities survived freshness/source filtering.");
        }
        if (recompetes.some((row) => row.signalType === "MONITORING_PROFILE")) {
            warnings.push("At least one recompete item is a modeled monitoring profile and must not be presented as a confirmed procurement event.");
        }

        const identitySource = contractor
            ? (sam ? "ORION_PLUS_CURRENT_SAM_QUALIFIED" : "ORION")
            : "CURRENT_SAM_QUALIFIED_UNIVERSE";
        const matchedNaics = contractor?.all_matched_naics ?? (sam?.naicsCodes ? splitTilde(sam.naicsCodes) : []);

        return {
            ok: true,
            service: "PROSPECT_GROWTH_ASSESSMENT",
            status: linkedOrionAvailable ? "ASSESSMENT_READY" : "ASSESSMENT_READY_SAM_IDENTITY_ORION_LINKS_UNAVAILABLE",
            generatedAt: new Date().toISOString(),
            asOfDate,
            term: searchTerm,
            match: {
                candidateCount: candidates.length + (sam ? 1 : 0),
                selectedContractorId: contractorId,
                selectedUei: contractor?.uei || sam?.uei || null,
                identitySource
            },
            company: {
                contractorId,
                company: contractor?.company || sam?.legalBusinessName || null,
                companyNorm: contractor?.company_norm || normalizeText(sam?.legalBusinessName) || null,
                uei: contractor?.uei || sam?.uei || null,
                cage: sam?.cage || contractor?.cage || contractor?.cage_code || null,
                website: sam?.website || contractor?.website || null,
                federalRevenue: contractor?.federal_revenue ?? null,
                awardCount: contractor?.award_count ?? null,
                vehicle: contractor?.vehicle || null,
                vehicleHint: contractor?.vehicle_hint || null,
                segment: contractor?.segment || null,
                primaryNaics: contractor?.primary_naics || sam?.primaryNaics || null,
                matchedNaics,
                smallBusinessFlag: contractor?.small_business_flag || null,
                industrySegment: contractor?.industry_segment || null,
                marketPriority: contractor?.market_priority || null,
                leadScore: contractor?.lead_score ?? null,
                city: contractor?.city || sam?.city || null,
                state: contractor?.state || sam?.state || null,
                entityStatus: sam ? "A" : (contractor?.entity_status || null),
                registrationDate: sam?.activationDate || contractor?.registration_date || null,
                expirationDate: sam?.registrationExpirationDate || contractor?.expiration_date || null,
                lastUpdated: sam?.lastUpdateDate || contractor?.last_updated || null,
                identitySource,
                samEvidenceSource: sam ? "SAM_QUALIFIED_UNIVERSE" : null
            },
            persona: persona
                ? {
                    primary: persona.primary_persona || null,
                    secondary: persona.secondary_persona || null,
                    score: persona.persona_score ?? null,
                    gsaUnderutilizedScore: persona.gsa_underutilized_score ?? null,
                    vaUnderutilizedScore: persona.va_underutilized_score ?? null,
                    plateauScore: persona.plateau_score ?? null,
                    agencyConcentrationScore: persona.agency_concentration_score ?? null,
                    recompeteRiskScore: persona.recompete_risk_score ?? null,
                    vehicleGapScore: persona.vehicle_gap_score ?? null,
                    setasideDependencyScore: persona.setaside_dependency_score ?? null,
                    growthExpansionScore: persona.growth_expansion_score ?? null,
                    lastUpdated: persona.last_updated || null
                }
                : null,
            recommendations,
            buyerAlignment: buyers,
            linkedOpportunities: opportunities,
            recompeteSignals: recompetes,
            dataQuality: {
                identitySource,
                rawOpportunityRows: rawOpportunities.length,
                prospectOpportunityRows: opportunities.length,
                filteredOpportunityRows: rawOpportunities.length - opportunities.length,
                rawRecompeteRows: rawRecompetes.length,
                upcomingRecompeteRows: recompetes.length,
                monitoringProfileRecompetes: recompetes.filter((row) => row.signalType === "MONITORING_PROFILE").length,
                warnings
            },
            evidence: {
                identitySource,
                samQualifiedUniverse: samResult?.evidence || null,
                samQualifiedMatch: sam || null,
                contractorJoinKey: linkedOrionAvailable ? "contractors.id" : null,
                recommendationJoinKey: linkedOrionAvailable ? "contractor_recommendations_v2.contractor_id" : null,
                personaJoinKey: linkedOrionAvailable ? "persona_scores.contractor_id" : null,
                buyerJoinKey: linkedOrionAvailable ? "buyers.company_id" : null,
                opportunityJoinKey: linkedOrionAvailable ? "opportunities.company_id" : null,
                recompeteJoinKey: linkedOrionAvailable ? "recompetes.company_id" : null
            },
            safety: {
                databaseMode: "READ_ONLY",
                writesEnabled: false,
                samQualifiedUniverseReadOnly: true,
                datasetRefreshExecuted: false,
                intelligenceJobExecuted: false,
                emailsSent: false,
                campaignsChanged: false
            }
        };
    }
}

module.exports = ProspectGrowthAssessmentService;
module.exports.normalizeText = normalizeText;
module.exports.splitTilde = splitTilde;
