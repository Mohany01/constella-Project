"use client";

import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/components/ui/modern-side-bar";
import { apiClient } from "@/lib/apiClient";

function formatNotificationDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const ALERT_TYPE_LABELS = {
  task_due_soon: "Due Soon",
  task_overdue: "Overdue",
  task_blocked: "Blocked",
  task_ready_to_start: "Ready",
  task_critical_path_delay: "Critical Path",
};

const ALERT_SEVERITY_LABELS = {
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const NOTIFICATION_TYPE_LABELS = {
  learning_path_sent: "Learning Path",
  task_assigned: "Assignment",
};

function buildInboxItems(notifications, alerts) {
  const mappedNotifications = notifications.map((item) => ({
    id: `notification-${item.id}`,
    source: "notification",
    createdAt: item.created_at,
    isPending: !item.is_read,
    pillTone: "notification",
    typeLabel:
      NOTIFICATION_TYPE_LABELS[item.type] ||
      String(item.type || "Notification").replace(/_/g, " "),
    title: item.title || "Notification",
    raw: item,
  }));

  const mappedAlerts = alerts.map((item) => ({
    id: `alert-${item.alert_id}`,
    source: "alert",
    createdAt: item.alert_date,
    isPending: !item.is_resolved,
    pillTone: String(item.severity || "medium").toLowerCase(),
    typeLabel: ALERT_TYPE_LABELS[item.alert_type] || "Alert",
    title: item.message || "Alert",
    raw: item,
  }));

  return [...mappedAlerts, ...mappedNotifications].sort((a, b) => {
    const left = new Date(a.createdAt || 0).getTime();
    const right = new Date(b.createdAt || 0).getTime();
    return right - left;
  });
}

export default function NotificationsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [activeTab, setActiveTab] = useState("all");
  const [markingId, setMarkingId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadInbox({ showLoading = false } = {}) {
      if (showLoading) {
        setLoading(true);
      }
      if (!cancelled) {
        setError("");
      }
      try {
        const [notificationsResult, alertsResult] = await Promise.allSettled([
          apiClient("/projects/notifications/me", { method: "GET" }),
          apiClient("/projects/alerts/me", { method: "GET" }),
        ]);
        if (cancelled) return;
        const nextNotifications =
          notificationsResult.status === "fulfilled" &&
          Array.isArray(notificationsResult.value?.notifications)
            ? notificationsResult.value.notifications
            : [];
        const nextAlerts =
          alertsResult.status === "fulfilled" &&
          Array.isArray(alertsResult.value?.alerts)
            ? alertsResult.value.alerts
            : [];

        setNotifications(nextNotifications);
        setAlerts(nextAlerts);

        const errors = [];
        if (notificationsResult.status === "rejected") {
          errors.push("messages");
        }
        if (alertsResult.status === "rejected") {
          errors.push("alerts");
        }
        if (errors.length) {
          setError(`Some inbox sections could not be loaded: ${errors.join(" and ")}.`);
        }
      } catch {
        if (cancelled) return;
        setError("Failed to load inbox.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadInbox({ showLoading: true });
    const timer = window.setInterval(() => {
      loadInbox();
    }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const unreadNotificationCount = useMemo(
    () => notifications.filter((item) => !item?.is_read).length,
    [notifications]
  );

  const activeAlertCount = useMemo(
    () => alerts.filter((item) => !item?.is_resolved).length,
    [alerts]
  );

  const inboxItems = useMemo(
    () => buildInboxItems(notifications, alerts),
    [notifications, alerts]
  );

  const visibleItems = useMemo(() => {
    if (activeTab === "notifications") {
      return inboxItems.filter((item) => item.source === "notification");
    }
    if (activeTab === "alerts") {
      return inboxItems.filter((item) => item.source === "alert");
    }
    return inboxItems;
  }, [activeTab, inboxItems]);

  async function handleMarkRead(notificationId) {
    setMarkingId(notificationId);
    try {
      const data = await apiClient("/projects/notifications/read", {
        method: "PATCH",
        body: JSON.stringify({ notification_id: notificationId }),
      });
      const updated = data?.notification;
      setNotifications((prev) =>
        prev.map((item) => (item.id === notificationId && updated ? updated : item))
      );
    } catch (err) {
      setError(err?.message || "Failed to update notification.");
    } finally {
      setMarkingId(null);
    }
  }

  async function handleResolveAlert(alertId) {
    setMarkingId(`alert-${alertId}`);
    try {
      const data = await apiClient("/projects/alerts/resolve", {
        method: "PATCH",
        body: JSON.stringify({ alert_id: alertId }),
      });
      const updated = data?.alert;
      setAlerts((prev) =>
        prev.map((item) => (item.alert_id === alertId && updated ? updated : item))
      );
    } catch (err) {
      setError(err?.message || "Failed to resolve alert.");
    } finally {
      setMarkingId(null);
    }
  }

  return (
    <div className="modern-dashboard">
      <Sidebar>
        <div className="ws-shell c-notifications-shell">
          <section className="ws-panel c-notifications-panel">
            <div className="c-notifications-head">
              <div>
                <p className="c-notifications-eyebrow">Inbox</p>
                <h1 className="c-notifications-title">Notifications</h1>
                <p className="c-notifications-subtitle">
                  Track informational messages and deadline alerts from across your work.
                </p>
              </div>
              <div className="c-notifications-summary-grid">
                <div className="c-notifications-summary">
                  <span className="c-notifications-summary-value">
                    {unreadNotificationCount}
                  </span>
                  <span className="c-notifications-summary-label">New Messages</span>
                </div>
                <div className="c-notifications-summary c-notifications-summary--alert">
                  <span className="c-notifications-summary-value">
                    {activeAlertCount}
                  </span>
                  <span className="c-notifications-summary-label">Active Alerts</span>
                </div>
              </div>
            </div>

            <div className="c-inbox-tabs" role="tablist" aria-label="Inbox filters">
              {[
                { id: "all", label: "All" },
                { id: "notifications", label: "Notifications" },
                { id: "alerts", label: "Alerts" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={`c-inbox-tab${activeTab === tab.id ? " is-active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {loading ? <div className="ws-empty">Loading inbox...</div> : null}
            {!loading && error ? <div className="ws-empty">{error}</div> : null}
            {!loading && !error && visibleItems.length === 0 ? (
              <div className="ws-empty">No inbox items yet.</div>
            ) : null}

            {!loading && !error && visibleItems.length > 0 ? (
              <div className="c-notifications-list">
                {visibleItems.map((item) => (
                  <article
                    key={item.id}
                    className={`c-notification-card${item.isPending ? " is-unread" : ""}${
                      item.source === "alert" ? " is-alert" : ""
                    }`}
                  >
                    <div className="c-notification-card-main">
                      <div className="c-notification-card-top">
                        <span
                          className={`c-notification-type c-notification-type--${item.pillTone}`}
                        >
                          {item.typeLabel}
                        </span>
                        <time className="c-notification-time">
                          {formatNotificationDate(item.createdAt)}
                        </time>
                        {item.source === "alert" ? (
                          <span className="c-notification-meta">
                            {ALERT_SEVERITY_LABELS[
                              String(item.raw?.severity || "medium").toLowerCase()
                            ] || "Alert"}
                          </span>
                        ) : null}
                      </div>
                      <h2 className="c-notification-title">{item.title}</h2>
                    </div>
                    {item.source === "notification" && item.isPending ? (
                      <button
                        type="button"
                        className="ws-btn ghost c-notification-action"
                        onClick={() => handleMarkRead(item.raw.id)}
                        disabled={markingId === item.raw.id}
                      >
                        {markingId === item.raw.id ? "Updating..." : "Mark as read"}
                      </button>
                    ) : null}
                    {item.source === "alert" && item.isPending ? (
                      <button
                        type="button"
                        className="ws-btn ghost c-notification-action"
                        onClick={() => handleResolveAlert(item.raw.alert_id)}
                        disabled={markingId === `alert-${item.raw.alert_id}`}
                      >
                        {markingId === `alert-${item.raw.alert_id}`
                          ? "Updating..."
                          : "Resolve"}
                      </button>
                    ) : null}
                    <span
                      className={`c-notification-state${
                        item.isPending ? " is-pending" : ""
                      }${item.source === "alert" ? " is-alert" : ""}`}
                    >
                      {!item.isPending
                        ? item.source === "alert"
                          ? "Resolved"
                          : "Seen"
                        : item.source === "alert"
                          ? "Active"
                          : "New"}
                    </span>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </Sidebar>
    </div>
  );
}
