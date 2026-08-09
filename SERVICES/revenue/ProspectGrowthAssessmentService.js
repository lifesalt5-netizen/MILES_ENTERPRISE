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
    }

    getOrion() {
        if (!this.orion) {
            this.orion = require("../../CONNECTORS/ORION/connector");
        }

        return this.orion;
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

        if (!init?.ok) {
            return {
                ok: false,
                service: "PROSPECT_GROWTH_ASSESSMENT",
                status: "ORION_UNAVAILABLE",
                error: init?.message || "ORION initialization failed.",
                readOnly: true
            };
        }

        const candidates = orion.searchContractors(
            searchTerm,
            Math.max(1, Math.min(Number(options.searchLimit) || 10, 50))
        );

        const contractor = this.selectContractor(searchTerm, candidates);

        if (!contractor) {
            return {
                ok: false,
                service: "PROSPECT_GROWTH_ASSESSMENT",
                status: "CONTRACTOR_NOT_FOUND",
                term: searchTerm,
                candidates: [],
                readOnly: true
            };
        }

        const contractorId = contractor.id;
        const detailLimit = Math.max(1, Math.min(Number(options.detailLimit) || 25, 100));
        const rawDetailLimit = Math.max(detailLimit, Math.min(Number(options.rawDetailLimit) || 100, 250));
        const asOfDate = toDateOnly(options.asOfDate || new Date()) || new Date().toISOString().slice(0, 10);

        const recommendationRows = orion.query(
            "SELECT * FROM contractor_recommendations_v2 WHERE contractor_id = ? LIMIT 1",
            [contractorId]
        );

        const personaRows = orion.query(
            "SELECT * FROM persona_scores WHERE contractor_id = ? LIMIT 1",
            [contractorId]
        );

        const buyers = orion.query(
            "SELECT * FROM buyers WHERE company_id = ? ORDER BY spend DESC, award_count DESC LIMIT ?",
            [contractorId, detailLimit]
        );

        const rawOpportunities = orion.query(
            "SELECT * FROM opportunities WHERE company_id = ? ORDER BY CASE WHEN due_date = '' OR due_date IS NULL THEN 1 ELSE 0 END, due_date ASC LIMIT ?",
            [contractorId, rawDetailLimit]
        );

        const rawRecompetes = orion.query(
            "SELECT * FROM recompetes WHERE company_id = ? ORDER BY CASE WHEN recompete_date = '' OR recompete_date IS NULL THEN 1 ELSE 0 END, recompete_date ASC LIMIT ?",
            [contractorId, rawDetailLimit]
        );

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
        if (buyers.length === 0) {
            warnings.push("No linked buyer history is available for this contractor.");
        }
        if (opportunities.length === 0) {
            warnings.push("No current prospect-safe linked opportunities survived freshness/source filtering.");
        }
        if (recompetes.some((row) => row.signalType === "MONITORING_PROFILE")) {
            warnings.push("At least one recompete item is a modeled monitoring profile and must not be presented as a confirmed procurement event.");
        }

        return {
            ok: true,
            service: "PROSPECT_GROWTH_ASSESSMENT",
            status: "ASSESSMENT_READY",
            generatedAt: new Date().toISOString(),
            asOfDate,
            term: searchTerm,
            match: {
                candidateCount: candidates.length,
                selectedContractorId: contractorId,
                selectedUei: contractor.uei || null
            },
            company: {
                contractorId,
                company: contractor.company || null,
                companyNorm: contractor.company_norm || null,
                uei: contractor.uei || null,
                federalRevenue: contractor.federal_revenue ?? null,
                awardCount: contractor.award_count ?? null,
                vehicle: contractor.vehicle || null,
                vehicleHint: contractor.vehicle_hint || null,
                segment: contractor.segment || null,
                primaryNaics: contractor.primary_naics || null,
                matchedNaics: contractor.all_matched_naics || null,
                smallBusinessFlag: contractor.small_business_flag || null,
                industrySegment: contractor.industry_segment || null,
                marketPriority: contractor.market_priority || null,
                leadScore: contractor.lead_score ?? null,
                city: contractor.city || null,
                state: contractor.state || null,
                entityStatus: contractor.entity_status || null,
                registrationDate: contractor.registration_date || null,
                expirationDate: contractor.expiration_date || null,
                lastUpdated: contractor.last_updated || null
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
                rawOpportunityRows: rawOpportunities.length,
                prospectOpportunityRows: opportunities.length,
                filteredOpportunityRows: rawOpportunities.length - opportunities.length,
                rawRecompeteRows: rawRecompetes.length,
                upcomingRecompeteRows: recompetes.length,
                monitoringProfileRecompetes: recompetes.filter((row) => row.signalType === "MONITORING_PROFILE").length,
                warnings
            },
            evidence: {
                contractorJoinKey: "contractors.id",
                recommendationJoinKey: "contractor_recommendations_v2.contractor_id",
                personaJoinKey: "persona_scores.contractor_id",
                buyerJoinKey: "buyers.company_id",
                opportunityJoinKey: "opportunities.company_id",
                recompeteJoinKey: "recompetes.company_id"
            },
            safety: {
                databaseMode: "READ_ONLY",
                writesEnabled: false,
                datasetRefreshExecuted: false,
                intelligenceJobExecuted: false,
                emailsSent: false,
                campaignsChanged: false
            }
        };
    }
}

module.exports = ProspectGrowthAssessmentService;
