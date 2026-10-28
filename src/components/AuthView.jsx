import React, { useId, useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { VERSE } from "../constants.js";
import { login, register } from "../apiClient.js";

const MIN_PASSWORD = 10;

/** Eingabefeld mit Label; ein Hinweis wird per aria-describedby verknüpft statt Teil des Labels zu sein. */
function Field({ label, hint, ...inputProps }) {
  const id = useId();
  return (
    <div className="nsr-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="nsr-input" aria-describedby={hint ? id + "-hint" : undefined} {...inputProps} />
      {hint && (
        <small id={id + "-hint"} className="nsr-hint">
          {hint}
        </small>
      )}
    </div>
  );
}

export function AuthView({ onAuthenticated }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isRegister = mode === "register";

  function switchMode(next) {
    setMode(next);
    setError("");
    setPassword("");
    setPassword2("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (isRegister) {
      if (password.length < MIN_PASSWORD) {
        setError(`Das Passwort muss mindestens ${MIN_PASSWORD} Zeichen lang sein.`);
        return;
      }
      if (password !== password2) {
        setError("Die beiden Passwörter stimmen nicht überein.");
        return;
      }
    }
    setBusy(true);
    try {
      const me = isRegister
        ? await register(email.trim(), password, displayName.trim())
        : await login(email.trim(), password);
      onAuthenticated(me);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="nsr-app">
      <header className="nsr-topbar">
        <span className="nsr-topbar-title nsr-auth-brand">Next Step</span>
      </header>
      <main className="nsr-main">
        <div className="nsr-view nsr-auth">
          <p className="nsr-verse">{VERSE}</p>

          <div className="nsr-auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={!isRegister}
              className={"nsr-auth-tab" + (!isRegister ? " nsr-auth-tab-active" : "")}
              onClick={() => switchMode("login")}
            >
              Anmelden
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isRegister}
              className={"nsr-auth-tab" + (isRegister ? " nsr-auth-tab-active" : "")}
              onClick={() => switchMode("register")}
            >
              Konto erstellen
            </button>
          </div>

          <form className="nsr-card nsr-auth-form" onSubmit={handleSubmit}>
            {isRegister && (
              <Field
                label="Dein Name"
                hint="Wird in deiner Gruppe angezeigt."
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="z. B. Julia"
                maxLength={60}
                autoComplete="nickname"
              />
            )}
            <Field
              label="E-Mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              autoComplete="email"
              inputMode="email"
            />
            <Field
              label="Passwort"
              hint={isRegister ? `Mindestens ${MIN_PASSWORD} Zeichen.` : undefined}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={isRegister ? MIN_PASSWORD : undefined}
              maxLength={200}
              autoComplete={isRegister ? "new-password" : "current-password"}
            />
            {isRegister && (
              <Field
                label="Passwort wiederholen"
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
                maxLength={200}
                autoComplete="new-password"
              />
            )}

            {error && (
              <p className="nsr-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="nsr-btn nsr-btn-primary nsr-btn-wide" disabled={busy}>
              {isRegister ? <UserPlus size={16} /> : <LogIn size={16} />}
              {busy ? "Einen Moment …" : isRegister ? "Konto erstellen" : "Anmelden"}
            </button>
          </form>

          {!isRegister && (
            <p className="nsr-hint nsr-center">
              Passwort vergessen? Wende dich an das IT-Team, es setzt dein Passwort zurück.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
