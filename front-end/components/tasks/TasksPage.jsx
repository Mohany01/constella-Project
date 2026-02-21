"use client";

import { Sidebar } from "../ui/modern-side-bar";
import TasksBoard from "./TasksBoard";

export default function TasksPage() {
  return (
    <div className="modern-dashboard">
      <Sidebar>
        <TasksBoard />
      </Sidebar>
    </div>
  );
}
