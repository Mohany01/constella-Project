"use client";

import { useState } from "react";
import { apiClient } from "../lib/apiClient";

export default function LoginForm({ className = "" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(null);
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setIsError(false);

    try {
      const data = await apiClient("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setMessage(data?.message || "Success!");
    } catch (error) {
      setIsError(true);
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={`grid gap-4 ${className}`.trim()} onSubmit={handleSubmit}>
      <div className="grid gap-2">
        <label className="subtitle text-sm text-gray-300" htmlFor="email">
          Email
        </label>
        <input
          className="input"
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="grid gap-2">
        <label className="subtitle text-sm text-gray-300" htmlFor="password">
          Password
        </label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          placeholder="********"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
      </div>

      <button className="btn" type="submit" disabled={loading}>
        {loading ? "Working..." : "Sign in"}
      </button>

      {message && (
        <div className={`${isError ? "error" : "success"} text-sm`} role="alert">
          {message}
        </div>
      )}
    </form>
  );
}

