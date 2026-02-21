const createTaskId = () => {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeTasks = (agentJson = []) => {
  const tasks = Array.isArray(agentJson) ? agentJson : agentJson?.tasks || [];
  return tasks.map((task, index) => ({
    id: task?.id ?? createTaskId(),
    original_name: typeof task?.name === "string" ? task.name : "",
    name: typeof task?.name === "string" && task.name.trim()
      ? task.name.trim()
      : `Task ${index + 1}`,
    description: typeof task?.description === "string" ? task.description : "",
    depends_on: Array.isArray(task?.depends_on)
      ? task.depends_on.filter(Boolean)
      : [],
    skills: Array.isArray(task?.skills) ? task.skills.filter(Boolean) : [],
    start_days_from_kickoff: toNumber(task?.start_days_from_kickoff, 0),
    duration_days: Math.max(1, toNumber(task?.duration_days, 1)),
    meta: {
      source: task?.meta?.source ?? task?.source ?? "agent",
      originalIndex: Number.isFinite(task?.meta?.originalIndex)
        ? task.meta.originalIndex
        : index,
    },
  }));
};

export const detectCycleDetails = (tasks = []) => {
  const taskMap = new Map();
  tasks.forEach((task) => {
    if (!taskMap.has(task.name)) {
      taskMap.set(task.name, task);
    }
  });

  const visiting = new Set();
  const visited = new Set();
  const path = [];
  const cycleNodes = new Set();

  const visit = (taskName) => {
    if (visiting.has(taskName)) {
      const startIndex = path.indexOf(taskName);
      if (startIndex !== -1) {
        path.slice(startIndex).forEach((name) => cycleNodes.add(name));
      }
      return;
    }
    if (visited.has(taskName)) return;
    const task = taskMap.get(taskName);
    if (!task) return;

    visiting.add(taskName);
    path.push(taskName);
    const deps = Array.isArray(task.depends_on) ? task.depends_on : [];
    deps.forEach((depName) => {
      if (taskMap.has(depName)) {
        visit(depName);
      }
    });
    path.pop();
    visiting.delete(taskName);
    visited.add(taskName);
  };

  tasks.forEach((task) => visit(task.name));
  return { hasCycle: cycleNodes.size > 0, cycleNodes };
};

export const detectCycle = (tasks = []) => detectCycleDetails(tasks).hasCycle;

export const computeSchedule = (tasks = []) => {
  const taskMap = new Map();
  tasks.forEach((task) => {
    if (!taskMap.has(task.name)) {
      taskMap.set(task.name, task);
    }
  });

  const cache = new Map();
  const visiting = new Set();
  const missingById = new Map();

  const getDuration = (task) => Math.max(1, toNumber(task.duration_days, 1));
  const getBaselineStart = (task) =>
    Math.max(0, toNumber(task.start_days_from_kickoff, 0));

  const calculateStart = (task) => {
    if (cache.has(task.id)) return cache.get(task.id);
    if (visiting.has(task.id)) return getBaselineStart(task);

    visiting.add(task.id);
    const deps = Array.isArray(task.depends_on) ? task.depends_on : [];
    let start = 0;
    const missing = [];

    if (deps.length) {
      let maxEnd = 0;
      deps.forEach((depName) => {
        const depTask = taskMap.get(depName);
        if (!depTask) {
          missing.push(depName);
          return;
        }
        const depStart = calculateStart(depTask);
        maxEnd = Math.max(maxEnd, depStart + getDuration(depTask));
      });
      start = maxEnd;
    }

    visiting.delete(task.id);
    const baseline = getBaselineStart(task);
    const resolvedStart = Math.max(baseline, start);
    cache.set(task.id, resolvedStart);
    if (missing.length) {
      missingById.set(task.id, Array.from(new Set(missing)));
    }
    return resolvedStart;
  };

  return tasks.map((task) => ({
    ...task,
    duration_days: getDuration(task),
    start_days_from_kickoff: calculateStart(task),
    missing_dependencies: missingById.get(task.id) || [],
  }));
};
