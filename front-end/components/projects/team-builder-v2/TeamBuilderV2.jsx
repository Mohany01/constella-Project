"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatDayRange,
  getInitials,
  getProgressTone,
  scoreToPercent,
} from "./utils";
import PeopleView from "./PeopleView";
import TasksView from "./TasksView";
import DetailsDrawer from "./DetailsDrawer";

const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildTaskItems = (data, analysisTasks = []) => {
  const taskMap = new Map((analysisTasks || []).map((task) => [task?.name || "", task]));
  const map = new Map();

  const ensureItem = (name) => {
    if (!map.has(name)) {
      map.set(name, {
        name,
        memberIds: [],
        memberDetails: [],
        start_day: Number.POSITIVE_INFINITY,
        end_day: 0,
        taskSkills: [],
        matchedSkills: [],
        missingSkills: [],
        bestMatch: 0,
        primaryAssignmentId: `unassigned::${name}`,
      });
    }
    return map.get(name);
  };

  (data?.assignments || []).forEach((assignment) => {
    if (!assignment?.task_name) return;
    const item = ensureItem(assignment.task_name);
    if (assignment.memberId) {
      item.memberIds.push(assignment.memberId);
    }
    item.memberDetails.push(assignment);
    const startDay = Number.isFinite(assignment.start_day)
      ? assignment.start_day
      : toNumber(assignment.start_day, 0);
    const endDay = Number.isFinite(assignment.end_day)
      ? assignment.end_day
      : toNumber(assignment.end_day, startDay + 1);
    item.start_day = Math.min(item.start_day, startDay);
    item.end_day = Math.max(item.end_day, endDay);
  });

  (data?.unassigned || []).forEach((task) => {
    if (!task?.task_name) return;
    const item = ensureItem(task.task_name);
    const startDay = Number.isFinite(task.start_day)
      ? task.start_day
      : toNumber(task.start_day, 0);
    const endDay = Number.isFinite(task.end_day)
      ? task.end_day
      : toNumber(task.end_day, startDay + 1);
    item.start_day = Math.min(item.start_day, startDay);
    item.end_day = Math.max(item.end_day, endDay);
    if (Array.isArray(task.skills) && task.skills.length) {
      const merged = new Set([...(item.taskSkills || []), ...task.skills]);
      item.taskSkills = Array.from(merged);
    }
  });

  (analysisTasks || []).forEach((task) => {
    if (!task?.name) return;
    const item = ensureItem(task.name);
    if (!item.taskSkills.length && Array.isArray(task.skills)) {
      item.taskSkills = task.skills.filter(Boolean);
    }
    if (
      !Number.isFinite(item.start_day) ||
      item.start_day === Number.POSITIVE_INFINITY
    ) {
      item.start_day = toNumber(task.start_days_from_kickoff, 0);
    }
    if (!Number.isFinite(item.end_day) || item.end_day === 0) {
      const duration = Math.max(1, toNumber(task.duration_days, 1));
      item.end_day = item.start_day + duration;
    }
  });

  return Array.from(map.values())
    .map((item) => {
      const detailMap = new Map();
      item.memberDetails.forEach((detail) => {
        if (detail?.memberId && !detailMap.has(detail.memberId)) {
          detailMap.set(detail.memberId, detail);
        }
    });
    const memberDetails = Array.from(detailMap.values());
    const memberIds = Array.from(new Set(item.memberIds.filter(Boolean)));
    let start = item.start_day;
    if (!Number.isFinite(start) || start === Number.POSITIVE_INFINITY) {
      start = 0;
    }
    let end = item.end_day;
    if (!Number.isFinite(end) || end <= start) {
      const analysisTask = taskMap.get(item.name);
      const duration = Math.max(1, toNumber(analysisTask?.duration_days, 1));
      end = start + duration;
    }
    const matched = new Set();
    const missing = new Set();
    memberDetails.forEach((detail) => {
      (detail.skills_match || []).forEach((skill) => matched.add(skill));
      (detail.missing_skills || []).forEach((skill) => missing.add(skill));
    });
    if (!memberDetails.length && item.taskSkills?.length) {
      item.taskSkills.forEach((skill) => missing.add(skill));
    }
    const bestMatch = memberDetails.reduce(
      (max, detail) =>
        Math.max(
          max,
          Number.isFinite(detail.semantic_match_score)
            ? detail.semantic_match_score
            : 0
        ),
      0
    );
      return {
        ...item,
        memberIds,
        memberDetails,
        primaryAssignmentId:
          memberDetails[0]?.id || `unassigned::${item.name}`,
        start_day: start,
        end_day: end,
        matchedSkills: Array.from(matched),
        missingSkills: Array.from(missing),
        bestMatch,
      };
    })
    .sort((a, b) =>
      a.start_day === b.start_day
        ? a.name.localeCompare(b.name)
        : a.start_day - b.start_day
    );
};

export default function TeamBuilderV2({
  data,
  analysisTasks = [],
  onAssignmentUpdate,
  onUnassignAssignment,
}) {
  const [viewMode, setViewMode] = useState("members");
  const [drawerState, setDrawerState] = useState(null);

  const members = data?.members || [];
  const membersById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members]
  );

  const taskItems = useMemo(
    () => buildTaskItems(data, analysisTasks),
    [data, analysisTasks]
  );

  const tasksByName = useMemo(
    () => new Map(taskItems.map((task) => [task.name, task])),
    [taskItems]
  );

  const assignmentsByMember = useMemo(() => {
    const map = new Map();
    (data?.assignments || []).forEach((assignment) => {
      if (!assignment?.memberId) return;
      const list = map.get(assignment.memberId) || [];
      const task = tasksByName.get(assignment.task_name);
      list.push({
        ...assignment,
        task,
      });
      map.set(assignment.memberId, list);
    });
    map.forEach((list) =>
      list.sort((a, b) => (a.start_day || 0) - (b.start_day || 0))
    );
    return map;
  }, [data, tasksByName]);

  const selectedTask =
    drawerState?.type === "task"
      ? tasksByName.get(drawerState.taskName)
      : null;
  const selectedMember =
    drawerState?.type === "person"
      ? membersById.get(drawerState.memberId)
      : null;

  const selectedAssignment =
    selectedTask && selectedTask.primaryAssignmentId
      ? (data?.assignments || []).find(
          (assignment) => assignment.id === selectedTask.primaryAssignmentId
        ) ||
        (typeof selectedTask.primaryAssignmentId === "string"
          ? {
              id: selectedTask.primaryAssignmentId,
              memberId: "",
              task_name: selectedTask.name,
              start_day: selectedTask.start_day,
              end_day: selectedTask.end_day,
              skills_match: [],
              missing_skills: selectedTask.missingSkills || [],
              semantic_match_score: selectedTask.bestMatch || 0,
            }
          : null)
      : null;

  const handleOpenTask = useCallback((taskName) => {
    setDrawerState({ type: "task", taskName });
  }, []);

  const handleOpenPerson = useCallback((memberId) => {
    setDrawerState({ type: "person", memberId });
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerState(null);
  }, []);


  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") {
        handleCloseDrawer();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleCloseDrawer]);

  useEffect(() => {
    setDrawerState(null);
  }, [data]);

  return (
    <div className="tb2-shell">
      <div className="tb2-view-switch">
        <button
          type="button"
          className={`tb2-view-btn ${
            viewMode === "members" ? "is-active" : ""
          }`}
          onClick={() => setViewMode("members")}
        >
          Members
        </button>
        <button
          type="button"
          className={`tb2-view-btn ${viewMode === "tasks" ? "is-active" : ""}`}
          onClick={() => setViewMode("tasks")}
        >
          Tasks
        </button>
      </div>

      <div className={`tb2-view-area ${drawerState ? "is-drawer-open" : ""}`}>
        {viewMode === "members" && (
          <PeopleView
            members={members}
            assignmentsByMember={assignmentsByMember}
            scoreToPercent={scoreToPercent}
            onOpenPerson={handleOpenPerson}
          />
        )}
        {viewMode === "tasks" && (
          <TasksView
            tasks={taskItems}
            members={members}
            membersById={membersById}
            scoreToPercent={scoreToPercent}
            getProgressTone={getProgressTone}
            formatDayRange={formatDayRange}
            onOpenTask={handleOpenTask}
            onOpenPerson={handleOpenPerson}
            onAssignmentUpdate={onAssignmentUpdate}
            onUnassignAssignment={onUnassignAssignment}
          />
        )}

        {drawerState && (
          <button
            type="button"
            className="tb2-drawer-overlay"
            onClick={handleCloseDrawer}
            aria-label="Close details drawer"
          />
        )}
      </div>

      <DetailsDrawer
        isOpen={Boolean(drawerState)}
        mode={drawerState?.type}
        task={selectedTask}
        assignment={selectedAssignment}
        member={selectedMember}
        assignmentsByMember={assignmentsByMember}
        members={members}
        scoreToPercent={scoreToPercent}
        getInitials={getInitials}
        formatDayRange={formatDayRange}
        onClose={handleCloseDrawer}
        onOpenPerson={handleOpenPerson}
        onUnassignAssignment={onUnassignAssignment}
        onReassign={onAssignmentUpdate}
      />
    </div>
  );
}

