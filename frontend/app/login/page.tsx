"use client";

import { useState } from "react";
import { apiFetch } from "../../lib/api";

function decodeRole(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload));
    return decoded.role ?? null;
  } catch {
    return null;
  }
}

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem("autoque_token")
  );
  const [message, setMessage] = useState<string | null>(null);

  const role = decodeRole(token);

  async function handleAuth(path: "/auth/login" | "/auth/register") {
    setMessage(null);
    try {
      const result = await apiFetch<{ token: string }>(path, {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      localStorage.setItem("autoque_token", result.token);
      setToken(result.token);
      setMessage("Authenticated successfully.");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  function handleLogout() {
    localStorage.removeItem("autoque_token");
    setToken(null);
    setMessage("Logged out.");
  }

  return (
    <section>
      <h2>Login / Register</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleAuth("/auth/login");
        }}
      >
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <div>
          <button type="submit">Login</button>
          <button
            type="button"
            className="secondary"
            onClick={() => handleAuth("/auth/register")}
          >
            Register
          </button>
          {token && (
            <button type="button" className="secondary" onClick={handleLogout}>
              Logout
            </button>
          )}
        </div>
      </form>
      {message && <p>{message}</p>}
      {token && (
        <div>
          <p>Token stored. Role: {role ?? "unknown"}</p>
          <p>
            <a href="/dashboard">Go to submitter dashboard</a>
          </p>
          {(role === "OPERATOR" || role === "ADMIN") && (
            <p>
              <a href="/operator">Go to operator dashboard</a>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
