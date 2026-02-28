const clampScore = (score) => {
  if (!Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, score));
};

export const scoreToPercent = (score) =>
  Math.round(clampScore(score) * 100);

export const getProgressTone = (percent) => {
  if (percent >= 75) return "good";
  if (percent >= 50) return "mid";
  return "low";
};

export const formatDayRange = (startDay, endDay) =>
  `Day ${startDay} \u2192 Day ${endDay}`;

export const getInitials = (name = "") =>
  name
    .split(" ")
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const getTaskCategory = (name = "") => {
  const value = name.toLowerCase();
  if (/(research|discovery|insight|user interview|survey)/.test(value)) {
    return "Research";
  }
  if (/(design|wireframe|prototype|ui|ux|visual|brand)/.test(value)) {
    return "Design";
  }
  if (/(implement|build|develop|code|engineering|api|backend|frontend)/.test(value)) {
    return "Implementation";
  }
  if (/(test|qa|quality|validate|review)/.test(value)) {
    return "QA";
  }
  if (/(plan|strategy|roadmap|kickoff)/.test(value)) {
    return "Planning";
  }
  return "";
};

