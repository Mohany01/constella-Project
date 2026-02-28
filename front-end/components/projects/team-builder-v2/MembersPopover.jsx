"use client";

import * as ReactDOM from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const positionPopover = (anchorRect, popoverRect, padding = 12, gap = 8) => {
  if (!anchorRect || !popoverRect) return null;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = anchorRect.left;
  let top = anchorRect.bottom + gap;
  let placement = "bottom";

  if (top + popoverRect.height > viewportHeight - padding) {
    top = anchorRect.top - popoverRect.height - gap;
    placement = "top";
  }

  if (left + popoverRect.width > viewportWidth - padding) {
    left = viewportWidth - popoverRect.width - padding;
  }

  left = clamp(left, padding, viewportWidth - popoverRect.width - padding);
  top = clamp(top, padding, viewportHeight - popoverRect.height - padding);

  return { top, left, placement };
};

const getEmail = (user) => {
  const email = user?.email || user?.employee_email;
  return email || "";
};

const getDisplayName = (user) => user?.name || "";

export default function MembersPopover({
  anchorEl,
  isOpen,
  onClose,
  projectMembers = [],
  assignedMemberIds,
  memberDetails,
  onAddMember,
  onRemoveMember,
}) {
  const popoverRef = useRef(null);
  const searchRef = useRef(null);
  const rafRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [allUsers, setAllUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const portalTarget =
    typeof document !== "undefined" ? document.body : null;

  const projectList = useMemo(() => {
    if (!projectMembers?.length) return [];
    const needle = query.trim().toLowerCase();
    const base = projectMembers.map((member) => ({
      ...member,
      __source: "project",
    }));
    if (!needle) return base;
    return base.filter((member) => {
      const label = `${getEmail(member)} ${member?.name || ""}`.toLowerCase();
      return label.includes(needle);
    });
  }, [projectMembers, query]);

  const assignedSet = useMemo(
    () => new Set(assignedMemberIds || []),
    [assignedMemberIds]
  );

  useEffect(() => {
    if (!isOpen) {
      setVisible(false);
      return;
    }
    const updatePosition = () => {
      if (!anchorEl || !popoverRef.current) return;
      const anchorRect = anchorEl.getBoundingClientRect();
      const popoverRect = popoverRef.current.getBoundingClientRect();
      const nextPosition = positionPopover(anchorRect, popoverRect);
      if (nextPosition) {
        setPosition({ top: nextPosition.top, left: nextPosition.left });
      }
    };

    const schedule = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        updatePosition();
      });
    };

    schedule();
    setVisible(true);
    const timeout = setTimeout(() => {
      searchRef.current?.focus();
    }, 60);

    const handleScroll = () => schedule();
    const handleResize = () => schedule();

    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [anchorEl, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    const handleClick = (event) => {
      if (popoverRef.current?.contains(event.target)) return;
      if (anchorEl?.contains(event.target)) return;
      onClose?.();
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("resize", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("resize", handleClick);
    };
  }, [anchorEl, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const timeout = setTimeout(async () => {
      setIsLoading(true);
      try {
        const { apiClient } = await import("../../../lib/apiClient");
        const response = await apiClient("/projects/employees", {
          method: "GET",
        });
        const list = Array.isArray(response)
          ? response
          : response?.employees || [];
        const needle = query.trim().toLowerCase();
        const filtered = needle
          ? list.filter((user) => {
              const label = `${getEmail(user)} ${user?.name || ""}`.toLowerCase();
              return label.includes(needle);
            })
          : list;
        setAllUsers(filtered);
      } catch (error) {
        setAllUsers([]);
      } finally {
        setIsLoading(false);
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, isOpen]);

  if (!isOpen || !portalTarget) return null;

  const renderRow = (user, sourceTag) => {
    const email = getEmail(user);
    const initial = (email || getDisplayName(user) || "?")[0];
    const isAssigned = assignedSet.has(user.id);
    const isProject = projectMembers.some((member) => member.id === user.id);
    const tag = sourceTag || (isProject ? "In project" : "External");
    return (
      <div
        key={`${sourceTag || "user"}-${user.id}`}
        className="tb2-popover-row"
      >
        <span className="tb2-avatar">{initial}</span>
        <div className="tb2-popover-user">
          <span className="tb2-popover-name">{email || "Unknown"}</span>
          {user?.name && (
            <span className="tb2-popover-email">{user.name}</span>
          )}
        </div>
        <span className="tb2-popover-tag">{tag}</span>
        <button
          type="button"
          className={`tb2-popover-action ${
            isAssigned ? "is-remove" : "is-add"
          }`}
          onClick={() =>
            isAssigned ? onRemoveMember?.(user.id) : onAddMember?.(user.id)
          }
        >
          {isAssigned ? "Remove" : "Add"}
        </button>
      </div>
    );
  };

  return ReactDOM.createPortal(
    <div
      ref={popoverRef}
      className={`tb2-members-popover ${visible ? "is-visible" : ""}`}
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-label="Members"
    >
      <div className="tb2-members-popover-head">
        <span>Members</span>
        <button type="button" className="tb2-icon-btn" onClick={onClose}>
          x
        </button>
      </div>
      <div className="tb2-members-popover-search">
        <input
          ref={searchRef}
          type="search"
          placeholder="Search members"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="tb2-members-popover-body">
        <div className="tb2-members-section">
          <p className="tb2-section-label">Project members</p>
          {projectList.length ? (
            <div className="tb2-popover-list">
              {projectList.map((user) => renderRow(user, "In project"))}
            </div>
          ) : (
            <span className="tb2-muted">No project members found.</span>
          )}
        </div>
        <div className="tb2-members-section">
          <p className="tb2-section-label">All users</p>
          {isLoading ? (
            <span className="tb2-muted">Loading...</span>
          ) : allUsers.length ? (
            <div className="tb2-popover-list">
              {allUsers.map((user) => renderRow(user))}
            </div>
          ) : (
            <span className="tb2-muted">No users found.</span>
          )}
        </div>
      </div>
    </div>,
    portalTarget
  );
}
