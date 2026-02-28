"use client";

import { Sidebar } from "../ui/modern-side-bar";
import ProjectsMain from "./ProjectsMain";

export default function ProjectPage() {
  return (
    <div className="modern-dashboard modern-dashboard--video">
      <div className="dashboard-video" aria-hidden="true">
        <video
          className="dashboard-video-media"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
        >
          <source src="/Dashboard%20back.mp4" type="video/mp4" />
        </video>
      </div>
      <Sidebar>
        <ProjectsMain />
      </Sidebar>
    </div>
  );
}
