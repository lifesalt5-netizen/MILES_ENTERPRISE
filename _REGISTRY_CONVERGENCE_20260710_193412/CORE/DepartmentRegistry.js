class DepartmentRegistry {
    constructor() {
        this.departments = {};
    }

    register(name, department) {
        if (!name || !department) {
            throw new Error("DepartmentRegistry.register requires name and department.");
        }

        this.departments[name] = {
            name,
            department,
            registeredAt: new Date().toISOString(),
            status: "Registered"
        };

        return this.departments[name];
    }

    get(name) {
        return this.departments[name] || null;
    }

    list() {
        return Object.values(this.departments).map(entry => ({
            name: entry.name,
            status: entry.status,
            registeredAt: entry.registeredAt
        }));
    }

    health() {
        return Object.values(this.departments).map(entry => {
            const dept = entry.department;

            if (dept && typeof dept.status === "function") {
                return {
                    name: entry.name,
                    health: "Healthy",
                    status: dept.status()
                };
            }

            if (dept && typeof dept.getDashboard === "function") {
                return {
                    name: entry.name,
                    health: "Healthy",
                    status: dept.getDashboard()
                };
            }

            return {
                name: entry.name,
                health: "Unknown",
                status: "No status method available"
            };
        });
    }
}

module.exports = DepartmentRegistry;