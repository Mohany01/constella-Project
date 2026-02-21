"use client";

import { Sidebar } from "../ui/modern-side-bar";
import DashboardMain from "./DashboardMain";

export default function DashboardPage() {
  return (
    <div className="modern-dashboard">
      <Sidebar>
        <DashboardMain />
      </Sidebar>
    </div>
  );
}
