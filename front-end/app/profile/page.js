"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "@/components/ui/modern-side-bar";
import { apiClient } from "@/lib/apiClient";
import { safeLocalStorageSet } from "@/lib/storage";
import { KeyRound, Pencil, Trash2, Upload, X } from "lucide-react";

const SKILL_CATEGORY_LABELS = {
  hard_skill: "Hard Skills",
  soft_skill: "Soft Skills",
  tool_tech: "Tools & Tech",
  language: "Languages",
  uncategorized: "Other Skills",
};

const PROFILE_SKILL_GROUPS = [
  { key: "hard_skill", label: "Hard Skills" },
  { key: "soft_skill", label: "Soft Skills" },
  { key: "tool_tech", label: "Tools & Tech" },
  { key: "language", label: "Languages" },
];

const CATEGORY_TO_GROUP = {
  hard_skill: "hard_skill",
  core_hard_skills: "hard_skill",
  hard_skills: "hard_skill",

  soft_skill: "soft_skill",
  core_soft_skills: "soft_skill",
  soft_skills: "soft_skill",

  tool_tech: "tool_tech",
  core_tools_and_tech: "tool_tech",
  tools_and_tech: "tool_tech",
  tools: "tool_tech",
  tech: "tool_tech",

  language: "language",
  languages: "language",
  core_languages: "language",
};

function toCategoryLabel(key) {
  if (SKILL_CATEGORY_LABELS[key]) return SKILL_CATEGORY_LABELS[key];
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordCode, setPasswordCode] = useState("");
  const [passwordVerificationId, setPasswordVerificationId] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordModalError, setPasswordModalError] = useState(false);
  const [isSkillsEditing, setIsSkillsEditing] = useState(false);
  const [skillsDraft, setSkillsDraft] = useState({
    hard_skill: [],
    soft_skill: [],
    tool_tech: [],
    language: [],
  });
  const [skillInputs, setSkillInputs] = useState({
    hard_skill: "",
    soft_skill: "",
    tool_tech: "",
    language: "",
  });
  const [skillsSaving, setSkillsSaving] = useState(false);
  const [skillsMessage, setSkillsMessage] = useState("");
  const [skillsError, setSkillsError] = useState(false);
  const fileRef = useRef(null);
  const avatarMenuRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setError("");
      try {
        const data = await apiClient("/auth/profile", { method: "GET" });
        if (cancelled) return;
        setProfile(data);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Failed to load profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!profile?.id || typeof window === "undefined") return;
    const saved = window.localStorage.getItem(`profile_photo_${profile.id}`) || "";
    setAvatarDataUrl(saved);
  }, [profile?.id]);

  useEffect(() => {
    if (!avatarMenuOpen) return;

    function handlePointerDown(event) {
      if (!avatarMenuRef.current?.contains(event.target)) {
        setAvatarMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setAvatarMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [avatarMenuOpen]);

  const initials = useMemo(() => {
    const source = profile?.name || "U";
    return source
      .split(" ")
      .map((word) => word[0] || "")
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }, [profile?.name]);

  const groupedSkills = useMemo(() => {
    const raw = profile?.skills_by_category || {};
    const grouped = {
      hard_skill: new Set(),
      soft_skill: new Set(),
      tool_tech: new Set(),
      language: new Set(),
    };

    Object.entries(raw).forEach(([rawKey, values]) => {
      const key = String(rawKey || "").trim().toLowerCase();
      const mapped = CATEGORY_TO_GROUP[key] || "hard_skill";
      const items = Array.isArray(values) ? values : [];
      items.forEach((skill) => {
        const cleaned = typeof skill === "string" ? skill.trim() : "";
        if (cleaned) grouped[mapped].add(cleaned);
      });
    });

    return PROFILE_SKILL_GROUPS.map((group) => ({
      key: group.key,
      label: group.label,
      items: Array.from(grouped[group.key]).sort((a, b) => a.localeCompare(b)),
    }));
  }, [profile?.skills_by_category]);

  useEffect(() => {
    setSkillsDraft({
      hard_skill: groupedSkills.find((g) => g.key === "hard_skill")?.items || [],
      soft_skill: groupedSkills.find((g) => g.key === "soft_skill")?.items || [],
      tool_tech: groupedSkills.find((g) => g.key === "tool_tech")?.items || [],
      language: groupedSkills.find((g) => g.key === "language")?.items || [],
    });
  }, [groupedSkills]);

  useEffect(() => {
    if (!skillsMessage || skillsError) return undefined;
    const timer = setTimeout(() => {
      setSkillsMessage("");
    }, 2200);
    return () => clearTimeout(timer);
  }, [skillsMessage, skillsError]);

  function handlePickAvatar() {
    setAvatarMenuOpen(false);
    fileRef.current?.click();
  }

  function handleRemoveAvatar() {
    setAvatarMenuOpen(false);
    setAvatarError("");
    setAvatarDataUrl("");
    if (profile?.id && typeof window !== "undefined") {
      window.localStorage.removeItem(`profile_photo_${profile.id}`);
    }
  }

  function handleAvatarChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setAvatarError("Please select an image file.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setAvatarError("Image must be under 2MB.");
      return;
    }

    setAvatarLoading(true);
    setAvatarError("");

    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === "string" ? reader.result : "";
      const img = new Image();
      img.onload = () => {
        const max = 512;
        const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setAvatarError("Failed to process image.");
          setAvatarLoading(false);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL("image/jpeg", 0.82);

        setAvatarDataUrl(compressed);
        if (profile?.id && typeof window !== "undefined") {
          const ok = safeLocalStorageSet(`profile_photo_${profile.id}`, compressed);
          if (!ok) {
            setAvatarError("Could not save photo in browser storage.");
          }
        }
        setAvatarLoading(false);
      };
      img.onerror = () => {
        setAvatarError("Failed to process image.");
        setAvatarLoading(false);
      };
      img.src = raw;
    };
    reader.onerror = () => {
      setAvatarError("Failed to load image.");
      setAvatarLoading(false);
    };
    reader.readAsDataURL(file);
  }

  function handleClosePasswordModal() {
    setShowPasswordModal(false);
    setNewPassword("");
    setConfirmNewPassword("");
    setPasswordCode("");
    setPasswordVerificationId("");
    setPasswordMessage("");
    setPasswordModalError(false);
    setPasswordLoading(false);
  }

  async function handleSendPasswordOtp() {
    if (!newPassword || !confirmNewPassword) {
      setPasswordModalError(true);
      setPasswordMessage("Please enter and confirm your new password.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordModalError(true);
      setPasswordMessage("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordModalError(true);
      setPasswordMessage("Passwords do not match.");
      return;
    }

    setPasswordLoading(true);
    setPasswordModalError(false);
    setPasswordMessage("");
    try {
      const data = await apiClient("/auth/password-change/start", {
        method: "POST",
        body: JSON.stringify({ new_password: newPassword }),
      });
      setPasswordVerificationId(data?.verification_id || "");
      setPasswordMessage(data?.message || "Verification code sent to your email.");
      setPasswordModalError(false);
    } catch (err) {
      setPasswordModalError(true);
      setPasswordMessage(err.message || "Failed to send verification code.");
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleVerifyPasswordOtp() {
    if (!passwordVerificationId) {
      setPasswordModalError(true);
      setPasswordMessage("Request OTP first.");
      return;
    }
    if (!passwordCode || passwordCode.length !== 6) {
      setPasswordModalError(true);
      setPasswordMessage("Enter the 6-digit verification code.");
      return;
    }

    setPasswordLoading(true);
    setPasswordModalError(false);
    setPasswordMessage("");
    try {
      const data = await apiClient("/auth/password-change/verify", {
        method: "POST",
        body: JSON.stringify({
          verification_id: passwordVerificationId,
          code: passwordCode,
        }),
      });
      setPasswordMessage(data?.message || "Password updated successfully.");
      setPasswordModalError(false);
      setTimeout(() => {
        handleClosePasswordModal();
      }, 700);
    } catch (err) {
      setPasswordModalError(true);
      setPasswordMessage(err.message || "Verification failed.");
    } finally {
      setPasswordLoading(false);
    }
  }

  function addSkill(categoryKey) {
    const raw = (skillInputs[categoryKey] || "").trim();
    if (!raw) return;
    setSkillsDraft((prev) => ({
      ...prev,
      [categoryKey]: Array.from(new Set([...(prev[categoryKey] || []), raw])),
    }));
    setSkillInputs((prev) => ({ ...prev, [categoryKey]: "" }));
  }

  function removeSkill(categoryKey, value) {
    setSkillsDraft((prev) => ({
      ...prev,
      [categoryKey]: (prev[categoryKey] || []).filter((s) => s !== value),
    }));
  }

  async function saveSkillsDraft() {
    setSkillsSaving(true);
    setSkillsMessage("");
    setSkillsError(false);
    try {
      const skills_by_category = {
        core_hard_skills: skillsDraft.hard_skill || [],
        core_soft_skills: skillsDraft.soft_skill || [],
        core_tools_and_tech: skillsDraft.tool_tech || [],
        core_languages: skillsDraft.language || [],
      };
      const skills = Array.from(
        new Set([
          ...skills_by_category.core_hard_skills,
          ...skills_by_category.core_soft_skills,
          ...skills_by_category.core_tools_and_tech,
          ...skills_by_category.core_languages,
        ])
      );

      await apiClient("/cv/save-skills", {
        method: "POST",
        body: JSON.stringify({ skills, skills_by_category }),
      });

      setProfile((prev) =>
        prev
          ? {
              ...prev,
              skills_by_category: {
                hard_skill: skillsDraft.hard_skill || [],
                soft_skill: skillsDraft.soft_skill || [],
                tool_tech: skillsDraft.tool_tech || [],
                language: skillsDraft.language || [],
              },
            }
          : prev
      );
      setIsSkillsEditing(false);
      setSkillsMessage("Skills saved.");
      setSkillsError(false);
    } catch (err) {
      setSkillsError(true);
      setSkillsMessage(err.message || "Failed to save skills.");
    } finally {
      setSkillsSaving(false);
    }
  }

  return (
    <div className="modern-dashboard">
      <Sidebar>
        <div className="ws-shell c-profile-shell">
          {loading ? (
            <section className="ws-panel c-profile-panel">
              <div className="ws-empty">Loading profile...</div>
            </section>
          ) : error ? (
            <section className="ws-panel c-profile-panel">
              <div className="ws-empty">{error}</div>
            </section>
          ) : (
            <section className="ws-panel c-profile-panel">
              <div className="c-profile-banner">
                <div className="c-profile-banner-head">
                  <div className="c-profile-avatar-col" ref={avatarMenuRef}>
                    <div className="c-profile-avatar-wrap">
                      {avatarDataUrl ? (
                        <img src={avatarDataUrl} alt="Profile avatar" className="c-profile-avatar" />
                      ) : (
                        <div className="c-profile-avatar-fallback">{initials}</div>
                      )}
                      <button
                        type="button"
                        className={`c-profile-avatar-edit${avatarMenuOpen ? " is-open" : ""}`}
                        onClick={() => setAvatarMenuOpen((prev) => !prev)}
                        aria-label="Edit profile photo"
                        aria-expanded={avatarMenuOpen}
                        aria-haspopup="menu"
                        disabled={avatarLoading}
                      >
                        <Pencil size={14} />
                      </button>
                    </div>

                    {avatarMenuOpen ? (
                      <div className="c-profile-avatar-menu">
                        <button type="button" className="c-profile-avatar-action" onClick={handlePickAvatar}>
                          <Upload size={14} />
                          <span>{avatarDataUrl ? "Change photo" : "Upload photo"}</span>
                        </button>
                        {avatarDataUrl ? (
                          <button
                            type="button"
                            className="c-profile-avatar-action is-danger"
                            onClick={handleRemoveAvatar}
                          >
                            <Trash2 size={14} />
                            <span>Delete photo</span>
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="c-profile-identity">
                    <h2 className="c-profile-name c-profile-name-inline">
                      {profile?.name || "Unknown User"}
                    </h2>
                    <p className="c-profile-role-inline">{profile?.role || "employee"}</p>
                  </div>

                  <button
                    type="button"
                    className="c-profile-password-icon c-profile-password-icon-top"
                    data-tip="Change password"
                    onClick={() => setShowPasswordModal(true)}
                    aria-label="Change password"
                  >
                    <KeyRound size={16} />
                  </button>
                </div>
              </div>

              <div className="c-profile-body">
                <div className="c-profile-content">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarChange}
                    hidden
                  />
                  <div className="c-profile-right">
                    <section className="c-profile-group">
                      <div className="c-profile-info-grid">
                        <div className="c-profile-info-item">
                          <span className="c-profile-info-label">Department</span>
                          <strong className="c-profile-info-value">{profile?.department || "General"}</strong>
                        </div>
                        <div className="c-profile-info-item">
                          <span className="c-profile-info-label">Email</span>
                          <strong className="c-profile-info-value">{profile?.email || "-"}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="c-profile-group">
                      <div className="c-profile-group-head">
                        <h3 className="c-profile-group-title">Skills by Category</h3>
                        {!isSkillsEditing ? (
                          <button
                            type="button"
                            className="c-profile-skill-edit-icon"
                            onClick={() => setIsSkillsEditing(true)}
                            aria-label="Edit skills"
                            title="Edit skills"
                          >
                            <Pencil size={14} />
                          </button>
                        ) : null}
                      </div>
                      <div className="c-profile-skill-actions">
                        {isSkillsEditing ? (
                          <>
                            <button
                              type="button"
                              className="ws-btn ws-btn-primary"
                              onClick={saveSkillsDraft}
                              disabled={skillsSaving}
                            >
                              {skillsSaving ? "Saving..." : "Save skills"}
                            </button>
                            <button
                              type="button"
                              className="ws-btn ws-btn-ghost"
                              onClick={() => setIsSkillsEditing(false)}
                              disabled={skillsSaving}
                            >
                              Cancel
                            </button>
                          </>
                        ) : null}
                      </div>
                      {skillsMessage ? (
                        <p className={skillsError ? "c-skill-msg is-error" : "c-skill-msg"}>{skillsMessage}</p>
                      ) : null}
                      <div className="c-profile-skills-wrap">
                        {groupedSkills.map((group) => (
                          <div key={group.key} className="c-profile-skill-card">
                            <h3>{group.label}</h3>
                            <div className="c-profile-skill-chips">
                              {(isSkillsEditing ? skillsDraft[group.key] || [] : group.items).length ? (
                                (isSkillsEditing ? skillsDraft[group.key] || [] : group.items).map((s) => (
                                  <span key={`${group.key}-${s}`} className="c-profile-skill-chip">
                                    {s}
                                  </span>
                                ))
                              ) : (
                                <span className="c-profile-skill-empty">No skills</span>
                              )}
                            </div>
                            {isSkillsEditing ? (
                              <div className="c-profile-skill-editor">
                                <input
                                  className="input modern"
                                  value={skillInputs[group.key] || ""}
                                  placeholder={`Add ${group.label}`}
                                  onChange={(e) =>
                                    setSkillInputs((prev) => ({ ...prev, [group.key]: e.target.value }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      addSkill(group.key);
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="ws-btn ws-btn-ghost"
                                  onClick={() => addSkill(group.key)}
                                >
                                  Add
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ))}
                        {groupedSkills.length === 0 ? (
                          <div className="c-profile-skill-card">
                            <h3>Skills</h3>
                            <div className="c-profile-skill-chips">
                              <span className="c-profile-skill-empty">No skills added yet</span>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  </div>
                </div>
                {avatarError ? <p className="c-profile-error">{avatarError}</p> : null}
              </div>
            </section>
          )}

          {showPasswordModal ? (
            <div className="signup-verify-backdrop" role="dialog" aria-modal="true">
              <div className="signup-verify-modal c-password-modal">
                <button
                  type="button"
                  className="c-password-modal-close"
                  onClick={handleClosePasswordModal}
                  aria-label="Close password modal"
                >
                  <X size={16} />
                </button>
                <h3>Change password</h3>
                <p>Enter a new password, then verify with the OTP sent to your email.</p>
                <input
                  className="input modern"
                  type="password"
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <input
                  className="input modern"
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSendPasswordOtp}
                  disabled={passwordLoading}
                >
                  {passwordLoading ? "Sending..." : "Send OTP"}
                </button>

                <input
                  className="input modern signup-verify-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={passwordCode}
                  onChange={(e) => setPasswordCode(e.target.value.replace(/\D/g, ""))}
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleVerifyPasswordOtp}
                  disabled={passwordLoading}
                >
                  {passwordLoading ? "Verifying..." : "Verify & Change"}
                </button>
                {passwordMessage ? (
                  <p className={passwordModalError ? "error" : "success"}>{passwordMessage}</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </Sidebar>
    </div>
  );
}
