import { type FormEvent, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";

export function LoginPage() {
  const { user, loading, isDispatcher, login } = useAuth();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(() => searchParams.get("email") || "");
  const [password, setPassword] = useState(() => searchParams.get("password") || searchParams.get("pwd") || "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user && isDispatcher) {
    return <Navigate to="/map" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={onSubmit}>
        <p className="brand">Waukee Talkee</p>
        <h1>Dispatcher console</h1>
        <p className="muted">
          Sign in to call drivers on the radio map — hold to talk, live location,
          pair codes.
        </p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        {!loading && user && !isDispatcher && (
          <p className="error">
            Signed in, but this account is not a dispatcher for org demo.
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Enter dispatch"}
        </button>
      </form>
    </div>
  );
}
