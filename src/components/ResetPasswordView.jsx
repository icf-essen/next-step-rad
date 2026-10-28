import React, { useId, useState } from "react";
import { KeyRound } from "lucide-react";
import { resetPassword } from "../apiClient.js";
import { LegalLinks } from "./LegalLinks.jsx";

const MIN_PASSWORD = 10;

/** Seite zum Festlegen eines neuen Passworts über einen Einmal-Link (#reset=…). */
export function ResetPasswordView({ token, legal, onDone, onCancel }) {
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD) return setError(`Das Passwort muss mindestens ${MIN_PASSWORD} Zeichen lang sein.`);
    if (password !== password2) return setError("Die beiden Passwörter stimmen nicht überein.");
    setBusy(true);
    try {
      await resetPassword(token, password);
      onDone();
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
          <h2 className="nsr-view-title">Neues Passwort festlegen</h2>
          <p className="nsr-hint" style={{ marginBottom: 14 }}>
            Dieser Link funktioniert nur einmal. Danach meldest du dich mit dem neuen Passwort an; auf anderen Geräten
            wirst du abgemeldet.
          </p>
          <form className="nsr-card nsr-auth-form" onSubmit={handleSubmit}>
            <div className="nsr-field">
              <label htmlFor={id + "-pw"}>Neues Passwort</label>
              <input
                id={id + "-pw"}
                type="password"
                className="nsr-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD}
                maxLength={200}
                autoComplete="new-password"
                aria-describedby={id + "-hint"}
              />
              <small id={id + "-hint"} className="nsr-hint">
                Mindestens {MIN_PASSWORD} Zeichen.
              </small>
            </div>
            <div className="nsr-field">
              <label htmlFor={id + "-pw2"}>Passwort wiederholen</label>
              <input
                id={id + "-pw2"}
                type="password"
                className="nsr-input"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
                maxLength={200}
                autoComplete="new-password"
              />
            </div>
            {error && (
              <p className="nsr-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="nsr-btn nsr-btn-primary nsr-btn-wide" disabled={busy}>
              <KeyRound size={16} /> {busy ? "Einen Moment …" : "Passwort speichern"}
            </button>
          </form>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
            <button type="button" className="nsr-link-btn" onClick={onCancel}>
              Abbrechen
            </button>
          </div>
          <LegalLinks legal={legal} />
        </div>
      </main>
    </div>
  );
}
