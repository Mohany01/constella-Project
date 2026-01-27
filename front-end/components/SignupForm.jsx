"use client";

import { useState } from "react";
import { apiClient } from "../lib/apiClient";

export default function SignupForm({ className = "" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const [message, setMessage] = useState(null);
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  // ----------------------
  // Email validation
  // ----------------------
  function handleEmailChange(value) {
    setEmail(value);
    if (message) {
      setMessage(null);
      setIsError(false);
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

  // ----------------------
  // Password validation (min 6 chars)
  // ----------------------
  function handlePasswordChange(value) {
    setPassword(value);

    if (!value) {
      setPasswordError("Password is required.");
    } else if (value.length < 6) {
      setPasswordError("Password must be at least 6 characters long.");
    } else {
      setPasswordError("");
    }
  }

  // ----------------------
  // Submit handler
  // ----------------------
  async function handleSubmit(e) {
    e.preventDefault();

    // Force validation before submit
    handleEmailChange(email);
    handlePasswordChange(password);

    if (!name || emailError || passwordError) {
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

      setMessage(data?.message || "Account created successfully.");
      setName("");
      setEmail("");
      setPassword("");
    } catch (error) {
      setIsError(true);
      setMessage(error.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={`grid gap-3 ${className}`.trim()} onSubmit={handleSubmit}>
      {/* Name */}
      <div className="grid gap-2">
        <label className="subtitle text-sm text-gray-300">Full name</label>
        <input
          className="input"
          placeholder="Jane Doe"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      {/* Email */}
      <div className="grid gap-1">
        <label className="subtitle text-sm text-gray-300">Email</label>
        <input
          className="input"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => handleEmailChange(e.target.value)}
          onFocus={() => {
            if (message) {
              setMessage(null);
              setIsError(false);
            }
          }}
          required
        />
        {emailError && <p className="text-red-500 text-xs">{emailError}</p>}
      </div>

      {/* Password */}
      <div className="grid gap-1">
        <label className="subtitle text-sm text-gray-300">Password</label>
        <input
          className="input"
          type="password"
          placeholder="********"
          value={password}
          onChange={(e) => handlePasswordChange(e.target.value)}
          required
        />
        {passwordError && (
          <p className="text-red-500 text-xs">{passwordError}</p>
        )}
      </div>

      <button className="btn" type="submit" disabled={loading}>
        {loading ? "Creating account..." : "Create account"}
      </button>

      {message && (
        <div className={`${isError ? "error" : "success"} text-sm`}>
          {message}
        </div>
      )}
    </form>
  );
}
