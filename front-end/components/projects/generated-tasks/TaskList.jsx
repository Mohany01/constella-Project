"use client";

import { useRef, useState } from "react";
import TaskCard from "./TaskCard";

export default function TaskList({
  tasks,
  conflictIds = new Set(),
  allTasks,
  readOnly = false,
  draggedDisabled = false,
  onRename,
  onStartChange,
  onEndChange,
  onDescriptionChange,
  onDependenciesChange,
  onDependencyDrop,
  onSkillsChange,
  onDelete,
  onDependencyHover,
  onReorder,
}) {
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const reorderedRef = useRef(false);

  const handleDragStart = (event, taskId) => {
    if (draggedDisabled) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", taskId);
    setDraggedId(taskId);
    reorderedRef.current = false;
  };

  const handleDragOver = (event, taskId) => {
    if (draggedDisabled) return;
    event.preventDefault();
    const sourceId = draggedId || event.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === taskId) return;
    if (taskId === dragOverId) return;
    setDragOverId(taskId);
    onReorder?.(sourceId, taskId);
    reorderedRef.current = true;
  };

  const handleDrop = (event, taskId) => {
    if (draggedDisabled) return;
    event.preventDefault();
    if (!reorderedRef.current) {
      const sourceId = draggedId || event.dataTransfer.getData("text/plain");
      if (sourceId && sourceId !== taskId) {
        onReorder?.(sourceId, taskId);
      }
    }
    setDraggedId(null);
    setDragOverId(null);
    reorderedRef.current = false;
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
    reorderedRef.current = false;
  };

  if (!tasks.length) {
    return (
      <div className="planner-empty">
        No tasks generated yet. Add one to get started.
      </div>
    );
  }

  return (
    <div className="task-list" role="list">
      {tasks.map((task, index) => (
        <TaskCard
          key={task.id}
          task={task}
          index={index}
          isConflict={conflictIds.has(task.id)}
          draggedId={draggedId}
          dragOverId={dragOverId}
          draggedDisabled={draggedDisabled || readOnly}
          readOnly={readOnly}
          allTasks={allTasks || tasks}
          onRename={onRename}
          onStartChange={onStartChange}
          onEndChange={onEndChange}
          onDescriptionChange={onDescriptionChange}
          onDependenciesChange={onDependenciesChange}
          onDependencyDrop={onDependencyDrop}
          onSkillsChange={onSkillsChange}
          onDelete={onDelete}
          onDependencyHover={onDependencyHover}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        />
      ))}
    </div>
  );
}
