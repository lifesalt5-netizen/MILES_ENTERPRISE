'use strict';

const fs = require('fs');
const path = require('path');

class CanonicalDatasetRegistry {

    constructor(registryPath = null) {

        this.registryPath = registryPath ||
            path.join(__dirname, '..', 'DATA', 'registry', 'CanonicalDatasetRegistry.json');

        this.registry = null;
        this.loaded = false;
    }

    load(forceReload = false) {

        if (this.loaded && !forceReload) {
            return this.registry;
        }

        if (!fs.existsSync(this.registryPath)) {
            throw new Error(
                `CanonicalDatasetRegistry not found:\n${this.registryPath}`
            );
        }

        const raw = fs.readFileSync(this.registryPath, 'utf8');

        this.registry = JSON.parse(raw);

        this.loaded = true;

        return this.registry;
    }

    reload() {
        return this.load(true);
    }

    getRegistry() {

        if (!this.loaded) this.load();

        return this.registry;
    }

    getSegment(segmentName) {

        if (!this.loaded) this.load();

        const segment = this.registry.segments[segmentName];

        if (!segment) {
            throw new Error(
                `Unknown segment: ${segmentName}`
            );
        }

        const primaryExists =
            segment.primary &&
            fs.existsSync(segment.primary);

        const fallbackExists =
            segment.fallback &&
            fs.existsSync(segment.fallback);

        return {

            ...segment,

            resolvedPath:
                primaryExists
                    ? segment.primary
                    : fallbackExists
                        ? segment.fallback
                        : null,

            using:
                primaryExists
                    ? 'PRIMARY'
                    : fallbackExists
                        ? 'FALLBACK'
                        : 'NONE',

            exists:
                primaryExists || fallbackExists
        };
    }

    getAllSegments() {

        if (!this.loaded) this.load();

        return Object.keys(this.registry.segments);
    }

    getVerifiedRepository(repository = 'primary') {

        if (!this.loaded) this.load();

        const repo =
            this.registry.verifiedRepositories[repository];

        if (!repo) {

            throw new Error(
                `Verified repository '${repository}' not found.`
            );
        }

        return {

            ...repo,

            exists: fs.existsSync(repo.path)
        };
    }

    getCampaign(segmentName) {

        if (!this.loaded) this.load();

        return this.registry.campaignMappings[segmentName] || null;
    }

    getDomain(domain) {

        if (!this.loaded) this.load();

        return this.registry.domains[domain] || null;
    }

    exists(datasetPath) {

        return fs.existsSync(datasetPath);
    }

    validate() {

        if (!this.loaded) this.load();

        const report = {

            valid: true,

            errors: [],

            warnings: []
        };

        for (const [name, segment] of Object.entries(this.registry.segments)) {

            const primary =
                segment.primary &&
                fs.existsSync(segment.primary);

            const fallback =
                segment.fallback &&
                fs.existsSync(segment.fallback);

            if (!primary && !fallback) {

                report.valid = false;

                report.errors.push({

                    type: 'SEGMENT',

                    name,

                    message: 'No usable dataset found.'
                });
            }
        }

        for (const [name, repo] of Object.entries(this.registry.verifiedRepositories)) {

            if (!fs.existsSync(repo.path)) {

                report.valid = false;

                report.errors.push({

                    type: 'VERIFIED_REPOSITORY',

                    name,

                    message: 'Repository missing.'
                });
            }
        }

        return report;
    }

    health() {

        if (!this.loaded) this.load();

        const validation = this.validate();

        const health = {

            status:
                validation.valid
                    ? 'HEALTHY'
                    : 'DEGRADED',

            registryLoaded: this.loaded,

            registryVersion:
                this.registry.version,

            totalSegments:
                Object.keys(this.registry.segments || {}).length,

            verifiedRepositories:
                Object.keys(this.registry.verifiedRepositories || {}).length,

            campaignMappings:
                Object.keys(this.registry.campaignMappings || {}).length,

            domains:
                Object.keys(this.registry.domains || {}).length,

            inventoryConfigured:
                Boolean(
                    this.registry.inventory &&
                    this.registry.inventory.segmentInventory
                ),

            validation
        };

        return health;
    }
}

module.exports = CanonicalDatasetRegistry;
module.exports.CanonicalDatasetRegistry = CanonicalDatasetRegistry;
module.exports.default = CanonicalDatasetRegistry;
