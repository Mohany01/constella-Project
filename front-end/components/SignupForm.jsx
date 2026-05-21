"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "../lib/apiClient";
import { USER_ROLES, normalizeRole } from "../lib/auth";
import { persistUserSession, syncCurrentUserProfile } from "../lib/auth-client";
import { safeLocalStorageSet } from "../lib/storage";

const OTP_LENGTH = 6;

export default function SignupForm({ className = "", step: externalStep, setStep: externalSetStep }) {
  const router = useRouter();
  const [stepInternal, setStepInternal] = useState(1);
  const step = externalStep ?? stepInternal;
  const setStep = externalSetStep ?? setStepInternal;
  const [subStep, setSubStep] = useState(1);

  // Step 1
  const [nameError, setNameError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Step 2
  const [role, setRole] = useState("employee");
  const [skills, setSkills] = useState([]);
  const [manualGroups, setManualGroups] = useState({
    core_hard_skills: [],
    core_tools_and_tech: [],
    core_soft_skills: [],
    core_languages: [],
  });
  const [extractedGroups, setExtractedGroups] = useState({
    core_hard_skills: [],
    core_tools_and_tech: [],
    core_soft_skills: [],
    core_languages: [],
  });
  const [hardSkillInput, setHardSkillInput] = useState("");
  const [softSkillInput, setSoftSkillInput] = useState("");
  const [toolsSkillInput, setToolsSkillInput] = useState("");
  const [languageSkillInput, setLanguageSkillInput] = useState("");
  const [cvFile, setCvFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [cvLoading, setCvLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [skillsSaved, setSkillsSaved] = useState(false);
  const [suggestionsByCategory, setSuggestionsByCategory] = useState({
    core_hard_skills: [],
    core_tools_and_tech: [],
    core_soft_skills: [],
    core_languages: [],
  });
  const [suggestLoadingByCategory, setSuggestLoadingByCategory] = useState({
    core_hard_skills: false,
    core_tools_and_tech: false,
    core_soft_skills: false,
    core_languages: false,
  });
  const suggestionTimersRef = useRef({});
  const categoryToApi = useMemo(
    () => ({
      core_hard_skills: "hard_skill",
      core_soft_skills: "soft_skill",
      core_tools_and_tech: "tool_tech",
      core_languages: "language",
    }),
    []
  );
  const miniStepsTotal = role === "employee" ? 1 : 0;
  const accountRoleLabel =
    role === "project_manager" ? "Project Manager" : "Employee";

  // Errors and messages
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [message, setMessage] = useState(null);
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [verificationId, setVerificationId] = useState("");
  const [verificationCode, setVerificationCode] = useState(() =>
    Array(OTP_LENGTH).fill("")
  );
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const otpInputsRef = useRef([]);

  const stepLabels = useMemo(
    () => [
      { id: 1, title: "Sign up your account", sub: "Create credentials" },
      { id: 2, title: "Set up your profile", sub: "Role, hours, skills" },
    ],
    []
  );

  // Validation helpers
  function handleEmailChange(value) {
    setEmail(value);
    if (message) {
      setMessage(null);
      setIsError(false);
    }
    if (!value) {
      setEmailError("Email is required.");
      return;
    }
    if (!value) {
      setEmailError("Email is required.");
    } else if (!value.includes("@")) {
      setEmailError("Email must include an '@' symbol.");
    } else if (!/\.[a-zA-Z]{2,}$/.test(value)) {
      setEmailError("Email must include a valid domain (e.g. .com).");
    } else {
      setEmailError("");
    }
  }

  function handlePasswordChange(value) {
    setPassword(value);
    if (!value) {
      setPasswordError("Password is required.");
    } else if (value.length < 6) {
      setPasswordError("Must be at least 6 characters.");
    } else {
      setPasswordError("");
    }
  }

  // Skills helpers
  function addManualSkill(category, value) {
    const trimmed = (value || "").trim();
    if (!trimmed) return;
    setSkillsSaved(false);
    setManualGroups((prev) => ({
      ...prev,
      [category]: Array.from(new Set([...(prev[category] || []), trimmed])),
    }));
    setSkills((prev) => Array.from(new Set([...prev, trimmed])));
  }

  function clearSuggestions(category) {
    setSuggestionsByCategory((prev) => ({ ...prev, [category]: [] }));
    setSuggestLoadingByCategory((prev) => ({ ...prev, [category]: false }));
  }

  function queueSuggestions(category, value) {
    const query = (value || "").trim();
    const backendCategory = categoryToApi[category];
    const timerId = suggestionTimersRef.current[category];
    if (timerId) clearTimeout(timerId);

    if (!query || !backendCategory) {
      clearSuggestions(category);
      return;
    }

    setSuggestLoadingByCategory((prev) => ({ ...prev, [category]: true }));
    suggestionTimersRef.current[category] = setTimeout(async () => {
      try {
        const data = await apiClient(
          `/cv/skill-suggestions?category=${encodeURIComponent(
            backendCategory
          )}&q=${encodeURIComponent(query)}&limit=8`
        );
        const existing = new Set(
          [...(extractedGroups[category] || []), ...(manualGroups[category] || [])].map(
            (item) => item.toLowerCase()
          )
        );
        const next = (Array.isArray(data?.suggestions) ? data.suggestions : []).filter(
          (name) => !existing.has(String(name).toLowerCase())
        );
        setSuggestionsByCategory((prev) => ({ ...prev, [category]: next }));
      } catch {
        setSuggestionsByCategory((prev) => ({ ...prev, [category]: [] }));
      } finally {
        setSuggestLoadingByCategory((prev) => ({ ...prev, [category]: false }));
      }
    }, 180);
  }

  function chooseSuggestion(category, value, setInput) {
    addManualSkill(category, value);
    setInput("");
    clearSuggestions(category);
  }

  function removeSkill(skill) {
    setSkillsSaved(false);
    setSkills((prev) => prev.filter((s) => s !== skill));
    setExtractedGroups((prev) => ({
      core_hard_skills: prev.core_hard_skills.filter((s) => s !== skill),
      core_tools_and_tech: prev.core_tools_and_tech.filter((s) => s !== skill),
      core_soft_skills: prev.core_soft_skills.filter((s) => s !== skill),
      core_languages: prev.core_languages.filter((s) => s !== skill),
    }));
    setManualGroups((prev) => ({
      core_hard_skills: prev.core_hard_skills.filter((s) => s !== skill),
      core_tools_and_tech: prev.core_tools_and_tech.filter((s) => s !== skill),
      core_soft_skills: prev.core_soft_skills.filter((s) => s !== skill),
      core_languages: prev.core_languages.filter((s) => s !== skill),
    }));
  }

  function mergeSkills(nextSkills) {
    const normalized = nextSkills
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean);
    if (!normalized.length) return;
    setSkills((prev) => Array.from(new Set([...prev, ...normalized])));
  }

  async function handleCvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCvFile(file);
    setSkillsSaved(false);
    setCvLoading(true);
    setMessage(null);
    setIsError(false);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await apiClient("/cv/extract", {
        method: "POST",
        body: formData,
      });
      const summary = data?.summary || {};
      const hard = summary.core_hard_skills || [];
      const tools = summary.core_tools_and_tech || [];
      const soft = summary.core_soft_skills || [];
      const languages = summary.core_languages || [];
      setExtractedGroups({
        core_hard_skills: Array.from(new Set(hard)),
        core_tools_and_tech: Array.from(new Set(tools)),
        core_soft_skills: Array.from(new Set(soft)),
        core_languages: Array.from(new Set(languages)),
      });
      mergeSkills([...hard, ...tools, ...soft, ...languages]);
    } catch (error) {
      setIsError(true);
      setMessage(error.message || "Failed to extract skills from CV.");
    } finally {
      setCvLoading(false);
    }
  }

  async function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file && /\.(pdf|docx?|txt)$/i.test(file.name)) {
      setCvFile(file);
      setSkillsSaved(false);
      setCvLoading(true);
      setMessage(null);
      setIsError(false);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const data = await apiClient("/cv/extract", {
          method: "POST",
          body: formData,
        });
        const summary = data?.summary || {};
        const hard = summary.core_hard_skills || [];
        const tools = summary.core_tools_and_tech || [];
        const soft = summary.core_soft_skills || [];
        const languages = summary.core_languages || [];
        setExtractedGroups({
          core_hard_skills: Array.from(new Set(hard)),
          core_tools_and_tech: Array.from(new Set(tools)),
          core_soft_skills: Array.from(new Set(soft)),
          core_languages: Array.from(new Set(languages)),
        });
        mergeSkills([...hard, ...tools, ...soft, ...languages]);
      } catch (error) {
        setIsError(true);
        setMessage(error.message || "Failed to extract skills from CV.");
      } finally {
        setCvLoading(false);
      }
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setDragActive(false);
  }

  function validateStepOneInputs() {
    const nextNameError = name.trim() ? "" : "Full name is required.";
    const trimmedEmail = email.trim();
    let nextEmailError = "";
    if (!trimmedEmail) {
      nextEmailError = "Email is required.";
    } else if (!trimmedEmail.includes("@")) {
      nextEmailError = "Email must include an '@' symbol.";
    } else if (!/\.[a-zA-Z]{2,}$/.test(trimmedEmail)) {
      nextEmailError = "Email must include a valid domain (e.g. .com).";
    }
    let nextPasswordError = "";
    if (!password) {
      nextPasswordError = "Password is required.";
    } else if (password.length < 6) {
      nextPasswordError = "Must be at least 6 characters.";
    }

    setNameError(nextNameError);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);

    if (nextNameError || nextEmailError || nextPasswordError) {
      setIsError(true);
      setMessage("Please fix the errors above.");
      return false;
    }
    return true;
  }

  function extractCooldownSeconds(message) {
    const text = String(message || "");
    const matched = text.match(/(\d+)\s*seconds?/i);
    if (!matched) return 0;
    return Number(matched[1]) || 0;
  }

  useEffect(() => {
    if (resendCooldownSec <= 0) return undefined;
    const timer = setInterval(() => {
      setResendCooldownSec((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldownSec]);

  useEffect(
    () => () => {
      Object.values(suggestionTimersRef.current || {}).forEach((timerId) => {
        if (timerId) clearTimeout(timerId);
      });
    },
    []
  );

  function resolveAccountRole(value) {
    return normalizeRole(value) === USER_ROLES.PROJECT_MANAGER
      ? "project_manager"
      : "employee";
  }

  async function completeAuthSuccess(data) {
    if (typeof window !== "undefined" && data?.token) {
      safeLocalStorageSet("token", data.token);
      persistUserSession({
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role,
      });
    }
    const profile = await syncCurrentUserProfile({
      id: data?.id,
      name: data?.name,
      email: data?.email,
      role: data?.role,
    });
    setRole(resolveAccountRole(profile?.role || data?.role));
    setVerificationCode(Array(OTP_LENGTH).fill(""));
    setShowVerificationModal(false);
    setMessage("Account verified successfully.");
    setIsError(false);
    setStep(2);
  }

  async function startSignupVerification() {
    if (!validateStepOneInputs()) {
      return false;
    }

    setLoading(true);
    setMessage(null);
    setIsError(false);

    try {
      const data = await apiClient("/auth/signup/start", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      });
      setVerificationId(data?.verification_id || "");
      setVerificationCode(Array(OTP_LENGTH).fill(""));
      setShowVerificationModal(true);
      setResendCooldownSec(Math.max(0, Number(data?.resend_cooldown_seconds || 0)));
      setMessage(data?.message || "Verification code sent to your email.");
      return true;
    } catch (error) {
      setIsError(true);
      setMessage(error.message || "Something went wrong.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    const code = verificationCode.join("").trim();
    if (!code) {
      setIsError(true);
      setMessage("Enter the verification code.");
      return;
    }
    if (code.length < OTP_LENGTH) {
      setIsError(true);
      setMessage("Enter the full 6-digit code.");
      return;
    }
    if (!verificationId) {
      setIsError(true);
      setMessage("Verification session missing. Please request a new code.");
      return;
    }

    setVerificationLoading(true);
    setMessage(null);
    setIsError(false);

    try {
      const data = await apiClient("/auth/signup/verify", {
        method: "POST",
        body: JSON.stringify({
          verification_id: verificationId,
          code,
        }),
      });
      await completeAuthSuccess(data);
    } catch (error) {
      setIsError(true);
      setMessage(error.message || "Verification failed.");
    } finally {
      setVerificationLoading(false);
    }
  }

  async function handleResendCode() {
    if (!validateStepOneInputs()) {
      return;
    }

    setResendLoading(true);
    setMessage(null);
    setIsError(false);

    try {
      const data = await apiClient("/auth/signup/start", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      });
      setVerificationId(data?.verification_id || "");
      setVerificationCode(Array(OTP_LENGTH).fill(""));
      setShowVerificationModal(true);
      setResendCooldownSec(Math.max(0, Number(data?.resend_cooldown_seconds || 0)));
      setMessage(data?.message || "Verification code resent.");
    } catch (error) {
      setIsError(true);
      setMessage(error.message || "Failed to resend code.");
      const waitSec = extractCooldownSeconds(error.message);
      if (waitSec > 0) {
        setResendCooldownSec(waitSec);
      }
    } finally {
      setResendLoading(false);
    }
  }

  // Step actions
  async function goNext() {
    await startSignupVerification();
  }

  function goBack() {
    setSubStep(1);
    setStep(1);
  }

  function focusOtpIndex(index) {
    const node = otpInputsRef.current[index];
    if (node) {
      node.focus();
      node.select?.();
    }
  }

  function applyOtpDigits(startIndex, digits) {
    setVerificationCode((prev) => {
      const next = [...prev];
      digits.forEach((digit, offset) => {
        const targetIndex = startIndex + offset;
        if (targetIndex < OTP_LENGTH) {
          next[targetIndex] = digit;
        }
      });
      return next;
    });
  }

  function handleOtpChange(index, value) {
    const digits = value.replace(/\D/g, "");
    if (!digits) {
      setVerificationCode((prev) => {
        const next = [...prev];
        next[index] = "";
        return next;
      });
      return;
    }
    const digitArray = digits.split("");
    applyOtpDigits(index, digitArray.slice(0, OTP_LENGTH - index));
    const nextIndex = Math.min(index + digitArray.length, OTP_LENGTH - 1);
    focusOtpIndex(nextIndex);
  }

  function handleOtpKeyDown(index, event) {
    if (event.key === "Backspace") {
      if (verificationCode[index]) {
        setVerificationCode((prev) => {
          const next = [...prev];
          next[index] = "";
          return next;
        });
        return;
      }
      if (index > 0) {
        focusOtpIndex(index - 1);
        setVerificationCode((prev) => {
          const next = [...prev];
          next[index - 1] = "";
          return next;
        });
      }
    } else if (event.key === "ArrowLeft" && index > 0) {
      focusOtpIndex(index - 1);
    } else if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      focusOtpIndex(index + 1);
    }
  }

  function handleOtpPaste(event) {
    const text = event.clipboardData?.getData("text") || "";
    const digits = text.replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!digits) return;
    event.preventDefault();
    setVerificationCode(Array(OTP_LENGTH).fill(""));
    applyOtpDigits(0, digits.split(""));
    focusOtpIndex(Math.min(digits.length, OTP_LENGTH - 1));
  }

  // Submit
  async function handleSubmit(e) {
    e?.preventDefault();
    if (step === 1) {
      await startSignupVerification();
      return;
    }
    if (role === "employee") {
      if (!cvFile) {
        setIsError(true);
        setMessage("Please upload your CV before finishing.");
        return;
      }
      if (!skillsSaved) {
        setIsError(true);
        setMessage("Please save your skills before finishing.");
        return;
      }
    }
    setMessage("Profile setup completed.");
    setIsError(false);
    router.push("/dashboard");
  }

  async function handleSaveSkills() {
    if (!skills.length) {
      setIsError(true);
      setMessage("Add or extract at least one skill before saving.");
      return;
    }
    setSaveLoading(true);
    setMessage(null);
    setIsError(false);
    try {
      const skillsByCategory = {
        core_hard_skills: Array.from(
          new Set([
            ...extractedGroups.core_hard_skills,
            ...manualGroups.core_hard_skills,
          ])
        ),
        core_soft_skills: Array.from(
          new Set([
            ...extractedGroups.core_soft_skills,
            ...manualGroups.core_soft_skills,
          ])
        ),
        core_tools_and_tech: Array.from(
          new Set([
            ...extractedGroups.core_tools_and_tech,
            ...manualGroups.core_tools_and_tech,
          ])
        ),
        core_languages: Array.from(
          new Set([
            ...extractedGroups.core_languages,
            ...manualGroups.core_languages,
          ])
        ),
      };

      const data = await apiClient("/cv/save-skills", {
        method: "POST",
        body: JSON.stringify({
          skills,
          skills_by_category: skillsByCategory,
        }),
      });
      setMessage(`Saved ${data?.saved_skills ?? 0} skills.`);
      setSkillsSaved(true);
    } catch (error) {
      setIsError(true);
      setMessage(error.message || "Failed to save skills.");
    } finally {
      setSaveLoading(false);
    }
  }

  return (
    <form
      className={`signup-form-shell ${className}`.trim()}
      onSubmit={handleSubmit}
    >
      {step === 1 && (
        <div className="step-panel animate-in">
          <div className="inline-stepper" aria-hidden>
            {stepLabels.map((s) => (
              <div
                key={s.id}
                className={`inline-step ${step === s.id ? "active" : ""}`}
              />
            ))}
          </div>

          <div className="field">
            <label htmlFor="name">Full name</label>
            <input
              id="name"
              className={`input modern ${nameError ? "input-error" : ""}`.trim()}
              placeholder="Jane Doe"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError("");
              }}
              required
              aria-invalid={!!nameError}
            />
            {nameError && (
              <p className="field-error" role="alert">
                {nameError}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className={`input modern ${
                emailError ? "input-error" : ""
              }`.trim()}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              aria-invalid={!!emailError}
              required
            />
            {emailError && (
              <p className="field-error" role="alert">
                {emailError}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div
              className={`input modern password-wrap ${
                passwordError ? "input-error" : ""
              }`.trim()}
            >
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="********"
                value={password}
                onChange={(e) => handlePasswordChange(e.target.value)}
                aria-invalid={!!passwordError}
                required
              />
              <button
                type="button"
                className="ghost-icon"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "👁" : "👁‍🗨"}
              </button>
            </div>
            {!password && <p className="field-hint">Must be at least 6 characters.</p>}
            {passwordError && (
              <p className="field-error" role="alert">
                {passwordError}
              </p>
            )}
          </div>

          <button className="btn-primary" type="button" onClick={goNext} disabled={loading}>
            {loading ? "Sending code..." : "Create account"}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="step-panel animate-in">
          {miniStepsTotal > 0 && (
            <div className="profile-mini-steps" aria-label="Profile setup progress">
              {Array.from({ length: miniStepsTotal }).map((_, idx) => (
                <span
                  key={idx}
                  className={`mini-step ${idx < subStep ? "active" : ""}`}
                />
              ))}
            </div>
          )}

              <div className="field">
                <label>Account Type</label>
                <div className="segment" aria-label="Account type from your employee profile">
                  <span className="segment-btn active" aria-current="true">
                    {accountRoleLabel}
                  </span>
                </div>
          </div>

          {role === "employee" && (
            <>
              <div
                className={`upload-card ${dragActive ? "dragging" : ""}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <div className="upload-info">
                  <p className="upload-title">Upload your CV</p>
                  <p className="upload-sub">
                    PDF or DOCX. We&apos;ll extract skills automatically.
                  </p>
                  <label className="upload-btn">
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.txt"
                      onChange={handleCvUpload}
                      hidden
                    />
                    Browse file
                  </label>
                  {cvFile ? (
                    <div className="upload-file">
                      <span>
                        {cvFile.name} ({Math.round(cvFile.size / 1024)} KB)
                      </span>
                      <button
                        type="button"
                        className="upload-remove"
                        onClick={() => {
                          setCvFile(null);
                          setSkillsSaved(false);
                        }}
                        aria-label="Remove file"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <p className="upload-file hint">Drag & drop or browse</p>
                  )}
                </div>
              </div>

              <div className="field">
                <div className="field-row">
                  <label>Skills</label>
                  <span className="field-hint">
                    Suggested from your CV
                    {cvLoading ? " (extracting...)" : ""}
                  </span>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="field-hint">Hard skills</p>
                    {(extractedGroups.core_hard_skills.length > 0 ||
                      manualGroups.core_hard_skills.length > 0) ? (
                      <div className="chips">
                        {Array.from(
                          new Set([
                            ...extractedGroups.core_hard_skills,
                            ...manualGroups.core_hard_skills,
                          ])
                        ).map((skill) => (
                          <span key={skill} className="chip chip-animate">
                            {skill}
                            <button
                              type="button"
                              className="chip-remove"
                              aria-label={`Remove ${skill}`}
                              onClick={() => removeSkill(skill)}
                            >
                              -
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="field-hint skills-placeholder">
                        No hard skills yet.
                      </p>
                    )}
                    <div className="add-skill-inline add-skill-inline--compact">
                      <input
                        className="input modern input-compact"
                        placeholder="Add hard skill"
                        value={hardSkillInput}
                        onChange={(e) => {
                          const value = e.target.value;
                          setHardSkillInput(value);
                          queueSuggestions("core_hard_skills", value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addManualSkill("core_hard_skills", hardSkillInput);
                            setHardSkillInput("");
                            clearSuggestions("core_hard_skills");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="pill-add icon-only pill-add--compact"
                        onClick={() => {
                          addManualSkill("core_hard_skills", hardSkillInput);
                          setHardSkillInput("");
                          clearSuggestions("core_hard_skills");
                        }}
                        aria-label="Add hard skill"
                      >
                        +
                      </button>
                    </div>
                    {suggestLoadingByCategory.core_hard_skills && hardSkillInput.trim() && (
                      <p className="field-hint">Loading suggestions...</p>
                    )}
                    {suggestionsByCategory.core_hard_skills.length > 0 && hardSkillInput.trim() && (
                      <div className="skill-suggest-list" role="listbox" aria-label="Hard skill suggestions">
                        {suggestionsByCategory.core_hard_skills.map((name) => (
                          <button
                            key={`hard-${name}`}
                            type="button"
                            className="skill-suggest-item"
                            onClick={() => chooseSuggestion("core_hard_skills", name, setHardSkillInput)}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="field-hint">Soft skills</p>
                    {(extractedGroups.core_soft_skills.length > 0 ||
                      manualGroups.core_soft_skills.length > 0) ? (
                      <div className="chips">
                        {Array.from(
                          new Set([
                            ...extractedGroups.core_soft_skills,
                            ...manualGroups.core_soft_skills,
                          ])
                        ).map((skill) => (
                          <span key={skill} className="chip chip-animate">
                            {skill}
                            <button
                              type="button"
                              className="chip-remove"
                              aria-label={`Remove ${skill}`}
                              onClick={() => removeSkill(skill)}
                            >
                              -
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="field-hint skills-placeholder">
                        No soft skills yet.
                      </p>
                    )}
                    <div className="add-skill-inline add-skill-inline--compact">
                      <input
                        className="input modern input-compact"
                        placeholder="Add soft skill"
                        value={softSkillInput}
                        onChange={(e) => {
                          const value = e.target.value;
                          setSoftSkillInput(value);
                          queueSuggestions("core_soft_skills", value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addManualSkill("core_soft_skills", softSkillInput);
                            setSoftSkillInput("");
                            clearSuggestions("core_soft_skills");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="pill-add icon-only pill-add--compact"
                        onClick={() => {
                          addManualSkill("core_soft_skills", softSkillInput);
                          setSoftSkillInput("");
                          clearSuggestions("core_soft_skills");
                        }}
                        aria-label="Add soft skill"
                      >
                        +
                      </button>
                    </div>
                    {suggestLoadingByCategory.core_soft_skills && softSkillInput.trim() && (
                      <p className="field-hint">Loading suggestions...</p>
                    )}
                    {suggestionsByCategory.core_soft_skills.length > 0 && softSkillInput.trim() && (
                      <div className="skill-suggest-list" role="listbox" aria-label="Soft skill suggestions">
                        {suggestionsByCategory.core_soft_skills.map((name) => (
                          <button
                            key={`soft-${name}`}
                            type="button"
                            className="skill-suggest-item"
                            onClick={() => chooseSuggestion("core_soft_skills", name, setSoftSkillInput)}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="field-hint">Tools and tech</p>
                    {(extractedGroups.core_tools_and_tech.length > 0 ||
                      manualGroups.core_tools_and_tech.length > 0) ? (
                      <div className="chips">
                        {Array.from(
                          new Set([
                            ...extractedGroups.core_tools_and_tech,
                            ...manualGroups.core_tools_and_tech,
                          ])
                        ).map((skill) => (
                          <span key={skill} className="chip chip-animate">
                            {skill}
                            <button
                              type="button"
                              className="chip-remove"
                              aria-label={`Remove ${skill}`}
                              onClick={() => removeSkill(skill)}
                            >
                              -
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="field-hint skills-placeholder">
                        No tools or tech yet.
                      </p>
                    )}
                    <div className="add-skill-inline add-skill-inline--compact">
                      <input
                        className="input modern input-compact"
                        placeholder="Add tool or tech"
                        value={toolsSkillInput}
                        onChange={(e) => {
                          const value = e.target.value;
                          setToolsSkillInput(value);
                          queueSuggestions("core_tools_and_tech", value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addManualSkill("core_tools_and_tech", toolsSkillInput);
                            setToolsSkillInput("");
                            clearSuggestions("core_tools_and_tech");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="pill-add icon-only pill-add--compact"
                        onClick={() => {
                          addManualSkill("core_tools_and_tech", toolsSkillInput);
                          setToolsSkillInput("");
                          clearSuggestions("core_tools_and_tech");
                        }}
                        aria-label="Add tool or tech"
                      >
                        +
                      </button>
                    </div>
                    {suggestLoadingByCategory.core_tools_and_tech && toolsSkillInput.trim() && (
                      <p className="field-hint">Loading suggestions...</p>
                    )}
                    {suggestionsByCategory.core_tools_and_tech.length > 0 && toolsSkillInput.trim() && (
                      <div className="skill-suggest-list" role="listbox" aria-label="Tools and tech suggestions">
                        {suggestionsByCategory.core_tools_and_tech.map((name) => (
                          <button
                            key={`tools-${name}`}
                            type="button"
                            className="skill-suggest-item"
                            onClick={() => chooseSuggestion("core_tools_and_tech", name, setToolsSkillInput)}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="field-hint">Languages</p>
                    {(extractedGroups.core_languages.length > 0 ||
                      manualGroups.core_languages.length > 0) ? (
                      <div className="chips">
                        {Array.from(
                          new Set([
                            ...extractedGroups.core_languages,
                            ...manualGroups.core_languages,
                          ])
                        ).map((skill) => (
                          <span key={skill} className="chip chip-animate">
                            {skill}
                            <button
                              type="button"
                              className="chip-remove"
                              aria-label={`Remove ${skill}`}
                              onClick={() => removeSkill(skill)}
                            >
                              -
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="field-hint skills-placeholder">
                        No languages yet.
                      </p>
                    )}
                    <div className="add-skill-inline add-skill-inline--compact">
                      <input
                        className="input modern input-compact"
                        placeholder="Add language"
                        value={languageSkillInput}
                        onChange={(e) => {
                          const value = e.target.value;
                          setLanguageSkillInput(value);
                          queueSuggestions("core_languages", value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addManualSkill("core_languages", languageSkillInput);
                            setLanguageSkillInput("");
                            clearSuggestions("core_languages");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="pill-add icon-only pill-add--compact"
                        onClick={() => {
                          addManualSkill("core_languages", languageSkillInput);
                          setLanguageSkillInput("");
                          clearSuggestions("core_languages");
                        }}
                        aria-label="Add language"
                      >
                        +
                      </button>
                    </div>
                    {suggestLoadingByCategory.core_languages && languageSkillInput.trim() && (
                      <p className="field-hint">Loading suggestions...</p>
                    )}
                    {suggestionsByCategory.core_languages.length > 0 && languageSkillInput.trim() && (
                      <div className="skill-suggest-list" role="listbox" aria-label="Language suggestions">
                        {suggestionsByCategory.core_languages.map((name) => (
                          <button
                            key={`lang-${name}`}
                            type="button"
                            className="skill-suggest-item"
                            onClick={() => chooseSuggestion("core_languages", name, setLanguageSkillInput)}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {skills.length === 0 && (
                  <p className="field-hint skills-placeholder">
                    Upload your CV to auto-fill skills, or add them manually.
                  </p>
                )}

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleSaveSkills}
                    disabled={saveLoading}
                  >
                    {saveLoading ? "Saving..." : "Save Skills"}
                  </button>
                </div>
              </div>
            </>
          )}

          {role === "employee" ? (
            <div className="actions">
              <div className="actions-left">
                <button type="button" className="ghost-btn" onClick={goBack}>
                  Back
                </button>
              </div>
              <div className="actions-right">
                <button
                  className="btn-primary"
                  type="submit"
                  disabled={loading || cvLoading || saveLoading}
                >
                  {loading ? "Finishing..." : "Finish setup"}
                </button>
              </div>
            </div>
          ) : (
            <div className="actions" style={{ justifyContent: "center" }}>
              <div className="actions-right" style={{ width: "auto" }}>
                <button className="btn-primary" type="submit" disabled={loading}>
                  {loading ? "Finishing..." : "Finish setup"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {message && (
        <div className={`${isError ? "error" : "success"} form-message`} role="alert">
          {message}
        </div>
      )}

      {showVerificationModal && (
        <div className="signup-verify-backdrop" role="dialog" aria-modal="true" aria-labelledby="verify-title">
          <div className="signup-verify-modal">
            <h3 id="verify-title">Verify your email</h3>
            <p>
              Enter the 6-digit code sent to <strong>{email}</strong>.
            </p>
            <div className="signup-verify-otp" onPaste={handleOtpPaste}>
              {verificationCode.map((digit, index) => (
                <input
                  key={`otp-${index}`}
                  ref={(el) => {
                    otpInputsRef.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  className="signup-verify-otp-input"
                  maxLength={1}
                  value={digit}
                  onChange={(event) => handleOtpChange(index, event.target.value)}
                  onKeyDown={(event) => handleOtpKeyDown(index, event)}
                  aria-label={`Verification code digit ${index + 1}`}
                />
              ))}
            </div>
            <div className="signup-verify-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={handleResendCode}
                disabled={resendLoading || verificationLoading || resendCooldownSec > 0}
              >
                {resendLoading
                  ? "Resending..."
                  : resendCooldownSec > 0
                  ? `Resend in ${resendCooldownSec}s`
                  : "Resend code"}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleVerifyCode}
                disabled={verificationLoading}
              >
                {verificationLoading ? "Verifying..." : "Verify code"}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
