"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiClient } from "@/lib/apiClient";
import {
  Home,
  User,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  FileText,
  Bell,
  Search,
  HelpCircle,
  ListChecks,
} from "lucide-react";

const navigationItems = [
  { id: "dashboard", name: "Dashboard", icon: Home, href: "/dashboard" },
  { id: "projects", name: "Projects", icon: FileText, href: "/projects", badge: "3" },
  { id: "tasks", name: "Tasks", icon: ListChecks, href: "/tasks" },
  { id: "notifications", name: "Notifications", icon: Bell, href: "/notifications" },
  { id: "profile", name: "Profile", icon: User, href: "/profile" },
  { id: "settings", name: "Settings", icon: Settings, href: "/settings" },
  { id: "help", name: "Help & Support", icon: HelpCircle, href: "/help" },
];

const DEFAULT_PROFILE = {
  name: "Constella Admin",
  role: "Administrator",
  initials: "CA",
};

function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "CA";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}

export function Sidebar({ className = "", children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeItem, setActiveItem] = useState("dashboard");
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [activeAlerts, setActiveAlerts] = useState(0);

  useEffect(() => {
    const handleResize = () => {
      setIsOpen(window.innerWidth >= 768);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname || "";
    const matched = navigationItems.find((item) => path.startsWith(item.href));
    if (matched) {
      setActiveItem(matched.id);
    }

    try {
      const raw = window.localStorage.getItem("user");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const name = typeof parsed?.name === "string" ? parsed.name.trim() : "";
      const role = typeof parsed?.email === "string" ? parsed.email.trim() : "Administrator";
      if (name) {
        setProfile({
          name,
          role,
          initials: getInitials(name),
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInboxCounts() {
      try {
        const [notificationsResult, alertsResult] = await Promise.allSettled([
          apiClient("/projects/notifications/me", { method: "GET" }),
          apiClient("/projects/alerts/me", { method: "GET" }),
        ]);
        if (cancelled) return;
        const notificationItems =
          notificationsResult.status === "fulfilled" &&
          Array.isArray(notificationsResult.value?.notifications)
            ? notificationsResult.value.notifications
            : [];
        const alertItems =
          alertsResult.status === "fulfilled" &&
          Array.isArray(alertsResult.value?.alerts)
            ? alertsResult.value.alerts
          : [];
        setUnreadNotifications(
          notificationItems.filter((item) => !item?.is_read).length
        );
        setActiveAlerts(alertItems.filter((item) => !item?.is_resolved).length);
      } catch {
        if (!cancelled) {
          setUnreadNotifications(0);
          setActiveAlerts(0);
        }
      }
    }

    loadInboxCounts();
    const timer = window.setInterval(loadInboxCounts, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const resolvedNavigationItems = useMemo(
    () =>
      navigationItems.map((item) =>
        item.id === "notifications"
          ? {
              ...item,
              badge:
                unreadNotifications + activeAlerts > 0
                  ? String(unreadNotifications + activeAlerts)
                  : undefined,
            }
          : item
      ),
    [activeAlerts, unreadNotifications]
  );

  const handleItemClick = (itemId) => {
    setActiveItem(itemId);
    if (window.innerWidth < 768) {
      setIsOpen(false);
    }
  };

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem("token");
        window.localStorage.removeItem("user");
      } catch {}
      // Ensure refresh cookie is cleared client-side as best effort.
      document.cookie = "refresh_token=; Max-Age=0; path=/; SameSite=Lax";
      window.location.href = "/login";
    }
  };

  const sidebarClassName = useMemo(() => {
    return [
      "modern-sidebar",
      isOpen ? "is-open" : "",
      isCollapsed ? "is-collapsed" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");
  }, [className, isCollapsed, isOpen]);

  const contentClassName = useMemo(() => {
    return ["sidebar-content", isCollapsed ? "is-collapsed" : ""].join(" ");
  }, [isCollapsed]);

  return (
    <>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="sidebar-toggle"
        aria-label="Toggle sidebar"
      >
        {isOpen ? <X className="icon" /> : <Menu className="icon" />}
      </button>

      {isOpen && <div className="sidebar-overlay" onClick={() => setIsOpen(false)} />}

      <aside
        className={sidebarClassName}
        style={{ position: "fixed", top: 0, left: 0, bottom: 0 }}
      >
        <div className="sidebar-header">
          {!isCollapsed ? (
            <div className="sidebar-brand">
              <div className="sidebar-brand-logo">
                <img src="/white%20Logo.png" alt="Constella logo" />
              </div>
              <div className="sidebar-brand-text">
                <span className="sidebar-brand-title">Constella</span>
                <span className="sidebar-brand-subtitle">Enterprise Dashboard</span>
              </div>
            </div>
          ) : (
            <div className="sidebar-brand-logo is-collapsed">
              <img src="/white%20Logo.png" alt="Constella logo" />
            </div>
          )}

          <button
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="sidebar-collapse"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <ChevronRight className="icon" /> : <ChevronLeft className="icon" />}
          </button>
        </div>

        {!isCollapsed && (
          <div className="sidebar-search">
            <Search className="sidebar-search-icon" />
            <input type="text" placeholder="Search..." className="sidebar-search-input" />
          </div>
        )}

        <nav className="sidebar-nav" aria-label="Primary navigation">
          <ul>
            {resolvedNavigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeItem === item.id;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={() => handleItemClick(item.id)}
                    className={[
                      "sidebar-item",
                      isActive ? "is-active" : "",
                      isCollapsed ? "is-collapsed" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title={isCollapsed ? item.name : undefined}
                  >
                    <span className="sidebar-icon">
                      <Icon className="sidebar-icon-svg" />
                    </span>

                    {!isCollapsed && (
                      <span className="sidebar-label">
                        <span className="sidebar-label-text">{item.name}</span>
                        {item.badge && (
                          <span className={`sidebar-badge ${isActive ? "is-active" : ""}`}>
                            {item.badge}
                          </span>
                        )}
                      </span>
                    )}

                    {isCollapsed && item.badge && (
                      <span className="sidebar-badge-mini">
                        {parseInt(item.badge) > 9 ? "9+" : item.badge}
                      </span>
                    )}

                    {isCollapsed && (
                      <span className="sidebar-tooltip">
                        {item.name}
                        {item.badge && <span className="sidebar-tooltip-badge">{item.badge}</span>}
                        <span className="sidebar-tooltip-arrow" />
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div className={`sidebar-profile ${isCollapsed ? "is-collapsed" : ""}`}>
            {!isCollapsed ? (
              <div className="sidebar-profile-card">
                <div className="sidebar-avatar">{profile.initials}</div>
                <div className="sidebar-profile-text">
                  <p className="sidebar-profile-name">{profile.name}</p>
                  <p className="sidebar-profile-role">{profile.role}</p>
                </div>
                <span className="sidebar-status" title="Online" />
              </div>
            ) : (
              <div className="sidebar-avatar-wrap">
                <div className="sidebar-avatar">{profile.initials}</div>
                <span className="sidebar-status is-mini" />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className={`sidebar-logout ${isCollapsed ? "is-collapsed" : ""}`}
            title={isCollapsed ? "Logout" : undefined}
          >
            <LogOut className="sidebar-logout-icon" />
            {!isCollapsed && <span>Logout</span>}
            {isCollapsed && (
              <span className="sidebar-tooltip">
                Logout
                <span className="sidebar-tooltip-arrow" />
              </span>
            )}
          </button>
        </div>
      </aside>

      <div className={contentClassName}>{children}</div>
    </>
  );
}
