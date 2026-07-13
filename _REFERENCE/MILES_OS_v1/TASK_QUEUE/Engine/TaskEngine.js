class TaskEngine {
    constructor() {
        this.tasks = [];
    }

    addTask(task) {
        const newTask = {
            id: `task_${Date.now()}`,
            status: "queued",
            priority: task.priority || "normal",
            title: task.title,
            system: task.system || "general",
            createdAt: new Date().toISOString()
        };

        this.tasks.push(newTask);
        return newTask;
    }

    listTasks() {
        return this.tasks;
    }
}

module.exports = new TaskEngine();