class EngineeringRegistry {

    constructor() {

        this.projects = [];

        this.features = [];

        this.bugs = [];

        this.releases = [];

        this.technicalDebt = [];

    }

    registerProject(project) {

        project.created = new Date().toISOString();

        this.projects.push(project);

        return project;

    }

    registerFeature(feature) {

        feature.created = new Date().toISOString();

        this.features.push(feature);

        return feature;

    }

    registerBug(bug) {

        bug.created = new Date().toISOString();

        this.bugs.push(bug);

        return bug;

    }

    registerRelease(release) {

        release.created = new Date().toISOString();

        this.releases.push(release);

        return release;

    }

    registerTechnicalDebt(item) {

        item.created = new Date().toISOString();

        this.technicalDebt.push(item);

        return item;

    }

    getSummary() {

        return {

            projects: this.projects.length,

            features: this.features.length,

            bugs: this.bugs.length,

            releases: this.releases.length,

            technicalDebt: this.technicalDebt.length

        };

    }

}

module.exports = EngineeringRegistry;