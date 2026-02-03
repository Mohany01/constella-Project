"use client";

import { useMemo, useState } from "react";
import { apiClient } from "../lib/apiClient";

const socialButtons = [
  { id: "google", label: "Continue with Google", icon: "G" },
  { id: "github", label: "Continue with GitHub", icon: "GH" },
];

export default function SignupForm({ className = "", step: externalStep, setStep: externalSetStep }) {
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
  const [role, setRole] = useState("company");
  const [totalHours, setTotalHours] = useState("");
  const [availableHours, setAvailableHours] = useState("");
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
  const [company, setCompany] = useState("");
  const [companyError, setCompanyError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [cvLoading, setCvLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const miniStepsTotal = role === "employee" ? 2 : 0;

  // Errors and messages
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [hoursError, setHoursError] = useState("");
  const [message, setMessage] = useState(null);
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

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

  function validateHours(total, available) {
    if (role !== "employee") {
      setHoursError("");
      return true;
    }
    if (!total || !available) {
      setHoursError("Please enter your weekly hours and availability.");
      return false;
    }
    if (Number(available) > Number(total)) {
      setHoursError("Available hours cannot exceed total hours per week.");
      return false;
    }
    setHoursError("");
    return true;
  }

  // Skills helpers
  function addManualSkill(category, value) {
    const trimmed = (value || "").trim();
    if (!trimmed) return;
    setManualGroups((prev) => ({
      ...prev,
      [category]: Array.from(new Set([...(prev[category] || []), trimmed])),
    }));
    setSkills((prev) => Array.from(new Set([...prev, trimmed])));
  }

  function removeSkill(skill) {
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

  // Step actions
  async function goNext() {
    if (!name.trim()) {
      setNameError("Full name is required.");
    } else {
      setNameError("");
    }
    handleEmailChange(email);
    handlePasswordChange(password);
    if (!name.trim() || emailError || passwordError) {
      setIsError(true);
      setMessage("Please fix the errors above.");
      return;
    }
    setIsError(false);
    setMessage(null);
    const created = await handleSubmit();
    if (created) {
      setStep(2); // optional profile step after account is created
    }
  }

  function goBack() {
    if (step === 2 && role === "employee" && subStep > 1) {
      setSubStep((s) => Math.max(1, s - 1));
      return;
    }
    setSubStep(1);
    setStep(1);
  }

  function handleSkip() {
    if (step === 2 && role === "employee" && subStep === 1) {
      setSubStep(2);
      return;
    }
    handleSubmit();
  }

  // Submit
  async function handleSubmit(e) {
    e?.preventDefault();
    const nameOk = !!name.trim();
    if (!nameOk) {
      setNameError("Full name is required.");
    }
    handleEmailChange(email);
    handlePasswordChange(password);
    const emailOk =
      !!email &&
      email.includes("@") &&
      email.includes(".");
    const passwordOk = !!password && password.length >= 6;
    const stepOneOk = nameOk && emailOk && passwordOk && !emailError && !passwordError;
    if (!stepOneOk) {
      setIsError(true);
      setMessage("Please fix the errors above.");
      return;
    }

    setLoading(true);
    setMessage(null);
    setIsError(false);

    try {
      const data = await apiClient("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      });
      if (typeof window !== "undefined" && data?.token) {
        localStorage.setItem("token", data.token);
        localStorage.setItem(
          "user",
          JSON.stringify({ id: data.id, name: data.name, email: data.email })
        );
      }
      setMessage("Account created successfully.");
      setName("");
      setEmail("");
      setPassword("");
      setTotalHours("");
      setAvailableHours("");
      setSkills([]);
      setManualGroups({
        core_hard_skills: [],
        core_tools_and_tech: [],
        core_soft_skills: [],
        core_languages: [],
      });
      setHardSkillInput("");
      setSoftSkillInput("");
      setToolsSkillInput("");
      setLanguageSkillInput("");
      setExtractedGroups({
        core_hard_skills: [],
        core_tools_and_tech: [],
        core_soft_skills: [],
        core_languages: [],
      });
      setCvFile(null);
      setCompany("");
      setCompanyError("");
      setStep(1);
      return true;
    } catch (error) {
      setIsError(true);
      setMessage(error.message || "Something went wrong.");
      return false;
    } finally {
      setLoading(false);
    }
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
      const data = await apiClient("/cv/save-skills", {
        method: "POST",
        body: JSON.stringify({ skills }),
      });
      setMessage(`Saved ${data?.saved_skills ?? 0} skills.`);
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

          <button className="btn-primary" type="button" onClick={goNext}>
            Create account
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
                <div className="segment">
                  {["company", "employee"].map((option) => (
                    <button
                  key={option}
                  type="button"
                  className={`segment-btn ${role === option ? "active" : ""}`}
                  onClick={() => setRole(option)}
                  aria-pressed={role === option}
                >
                  {option === "company" ? "Company" : "Employee"}
                </button>
              ))}
            </div>
          </div>

          {role === "employee" && subStep === 1 && (
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
                    PDF or DOCX. We'll extract skills automatically.
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
                        onClick={() => setCvFile(null)}
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
                        onChange={(e) => setHardSkillInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addManualSkill("core_hard_skills", hardSkillInput);
                            setHardSkillInput("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="pill-add icon-only pill-add--compact"
                        onClick={() => {
                          addManualSkill("core_hard_skills", hardSkillInput);
                          setHardSkillInput("");
                        }}
                        aria-label="Add hard skill"
                      >
                        +
                      </button>
                    </div>
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
                        onChange={(e) => setSoftSkillInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addManualSkill("core_soft_skills", softSkillInput);
                            setSoftSkillInput("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="pill-add icon-only pill-add--compact"
                        onClick={() => {
                          addManualSkill("core_soft_skills", softSkillInput);
                          setSoftSkillInput("");
                        }}
                        aria-label="Add soft skill"
                      >
                        +
                      </button>
                    </div>
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
                        onChange={(e) => setToolsSkillInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addManualSkill("core_tools_and_tech", toolsSkillInput);
                            setToolsSkillInput("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="pill-add icon-only pill-add--compact"
                        onClick={() => {
                          addManualSkill("core_tools_and_tech", toolsSkillInput);
                          setToolsSkillInput("");
                        }}
                        aria-label="Add tool or tech"
                      >
                        +
                      </button>
                    </div>
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
                        onChange={(e) => setLanguageSkillInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addManualSkill("core_languages", languageSkillInput);
                            setLanguageSkillInput("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="pill-add icon-only pill-add--compact"
                        onClick={() => {
                          addManualSkill("core_languages", languageSkillInput);
                          setLanguageSkillInput("");
                        }}
                        aria-label="Add language"
                      >
                        +
                      </button>
                    </div>
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

          {role === "employee" && subStep === 2 && (
            <div className="grid-2">
              <div className="field">
                <label htmlFor="totalHours">Total hours per week</label>
                <input
                  id="totalHours"
                  className="input modern"
                  type="number"
                  min="1"
                  placeholder="e.g. 40"
                  value={totalHours}
                  onChange={(e) => setTotalHours(e.target.value)}
                  required
                />
                <div className="field-feedback-spacer" aria-hidden />
              </div>
              <div className="field">
                <label htmlFor="availableHours">Available hours</label>
                <input
                  id="availableHours"
                  className={`input modern ${hoursError ? "input-error" : ""}`.trim()}
                  type="number"
                  min="0"
                  placeholder="e.g. 30"
                  value={availableHours}
                  onChange={(e) => setAvailableHours(e.target.value)}
                  aria-invalid={!!hoursError}
                  required
                />
                {hoursError ? (
                  <p className="field-error" role="alert">
                    {hoursError}
                  </p>
                ) : (
                  <div className="field-feedback-spacer" aria-hidden />
                )}
              </div>
            </div>
          )}

          {role === "company" && (
            <div className="field">
              <label htmlFor="company">Company</label>
              <input
                id="company"
                className={`input modern ${companyError ? "input-error" : ""}`.trim()}
                placeholder="company name"
                value={company}
                onChange={(e) => {
                  setCompany(e.target.value);
                  if (companyError) setCompanyError("");
                }}
                required
              />
              {companyError ? (
                <p className="field-error" role="alert">
                  {companyError}
                </p>
              ) : (
                <div className="field-feedback-spacer" aria-hidden />
              )}
            </div>
          )}

          <div className="actions">
            <div className="actions-left">
              <button type="button" className="ghost-btn" onClick={goBack}>
                Back
              </button>
              <button
                type="button"
                className="ghost-btn skip-btn"
                onClick={handleSkip}
                disabled={loading}
              >
                Skip
              </button>
            </div>
            <div className="actions-right">
              <button
                className="btn-primary"
                type={role === "employee" && subStep === 1 ? "button" : "submit"}
                onClick={
                  role === "employee" && subStep === 1
                    ? () => setSubStep(2)
                    : undefined
                }
                disabled={loading}
              >
                {role === "employee" && subStep === 1
                  ? "Continue"
                  : loading
                  ? "Finishing..."
                  : "Finish setup"}
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className={`${isError ? "error" : "success"} form-message`} role="alert">
          {message}
        </div>
      )}
    </form>
  );
}
