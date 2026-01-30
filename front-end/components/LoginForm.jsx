"use client";

import { useState } from "react";
import { apiClient } from "../lib/apiClient";

export default function LoginForm({ className = "" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const [message, setMessage] = useState(null);
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  // 🔹 Email validation
  function handleEmailChange(value) {
    setEmail(value);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      setEmailError("Please enter a valid email address");
    } else {
      setEmailError("");
    }
  }

  // 🔹 Password validation
  function handlePasswordChange(value) {
    setPassword(value);

    if (!value) {
      setPasswordError("Password is required");
    } else {
      setPasswordError("");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    // Final frontend check
    if (emailError || passwordError || !email || !password) {
      setIsError(true);
      setMessage("Please fix the errors above");
      return;
    }

    setLoading(true);
    setMessage(null);
    setIsError(false);

    try {
      const data = await apiClient("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      setMessage(`Welcome back, ${data.name} 👋`);
    } catch (error) {
      setIsError(true);
      setMessage(error.message || "Invalid email or password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={`grid gap-3 ${className}`.trim()} onSubmit={handleSubmit}>
      {/* Email */}
      <div className="grid gap-1">
        <input
          className="input"
          type="email"
          placeholder="Enter your email address"
          aria-label="Email address"
          value={email}
          onChange={(e) => handleEmailChange(e.target.value)}
          required
        />
        {emailError && <p className="text-red-500 text-xs">{emailError}</p>}
      </div>

      {/* Password */}
      <div className="grid gap-1">
        <input
          className="input"
          type="password"
          placeholder="Enter your password"
          aria-label="Password"
          value={password}
          onChange={(e) => handlePasswordChange(e.target.value)}
          required
        />
        {passwordError && (
          <p className="text-red-500 text-xs">{passwordError}</p>
        )}
      </div>

      <button className="btn" type="submit" disabled={loading}>
        {loading ? "Signing in..." : "Login"}
      </button>

      {message && (
        <div className={`${isError ? "error" : "success"} text-sm`}>
          {message}
        </div>
      )}
    </form>
  );
}
