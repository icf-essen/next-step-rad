import React, { useId, useState } from "react";
import { KeyRound, LogIn, MailCheck, Send, UserPlus } from "lucide-react";
import { VERSE } from "../constants.js";
import { forgotPassword, login, register, resendVerification, startSso } from "../apiClient.js";
import { LegalLinks } from "./LegalLinks.jsx";

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

export function AuthView({ options, ssoError, notice, onAuthenticated }) {
  // "login" | "register" | "forgot"
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unverified, setUnverified] = useState(false);
  // Erfolgsmeldung nach Registrierung, erneutem Senden oder "Passwort vergessen"
  const [info, setInfo] = useState(notice || "");

  const isRegister = mode === "register";
  const isForgot = mode === "forgot";

  function switchMode(next) {
    setMode(next);
    setError("");
    setInfo("");
    setUnverified(false);
    setPassword("");
    setPassword2("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    setUnverified(false);
    if (isRegister) {
      if (password.length < MIN_PASSWORD) return setError(`Das Passwort muss mindestens ${MIN_PASSWORD} Zeichen lang sein.`);
      if (password !== password2) return setError("Die beiden Passwörter stimmen nicht überein.");
    }
    setBusy(true);
    try {
      if (isForgot) {
        await forgotPassword(email.trim());
        setInfo(
          `Falls es für ${email.trim()} ein Konto gibt, haben wir dir eine E-Mail mit einem Link geschickt. Schau auch im Spam-Ordner nach.`
        );
      } else if (isRegister) {
        await register(email.trim(), password, displayName.trim());
        setMode("login");
        setPassword("");
        setPassword2("");
        setInfo(
          `Fast geschafft: Wir haben dir eine E-Mail an ${email.trim()} geschickt. Bitte bestätige darin deine Adresse, danach kannst du dich anmelden.`
        );
      } else {
        onAuthenticated(await login(email.trim(), password));
        return;
      }
    } catch (err) {
      setError(err.message);
      if (err.code === "email_unverified") setUnverified(true);
    }
    setBusy(false);
  }

  async function handleResend() {
    setBusy(true);
    setError("");
    try {
      await resendVerification(email.trim(), password);
      setUnverified(false);
      setInfo(`Wir haben dir eine neue Bestätigungsmail an ${email.trim()} geschickt.`);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <div className="nsr-app">
      <header className="nsr-topbar">
        <span className="nsr-topbar-title nsr-auth-brand">Next Step</span>
      </header>
      <main className="nsr-main">
        <div className="nsr-view nsr-auth">
          <p className="nsr-verse">{VERSE}</p>

          {ssoError && (
            <p className="nsr-error nsr-auth-notice" role="alert">
              {ssoError}
            </p>
          )}

          {info && (
            <p className="nsr-auth-info" role="status">
              <MailCheck size={18} /> <span>{info}</span>
            </p>
          )}

          {options?.sso && !isForgot && (
            <>
              <button
                type="button"
                className="nsr-btn nsr-btn-primary nsr-btn-wide nsr-sso-btn"
                onClick={() => startSso("login")}
              >
                <KeyRound size={16} /> {options.ssoLabel || "Mit ICF-Konto anmelden"}
              </button>
              <div className="nsr-divider">
                <span>oder mit E-Mail und Passwort</span>
              </div>
            </>
          )}

          {isForgot ? (
            <p className="nsr-sheet-subhead" style={{ marginTop: 0 }}>
              Passwort vergessen
            </p>
          ) : (
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
          )}

          <form className="nsr-card nsr-auth-form" onSubmit={handleSubmit}>
            {isForgot && (
              <p className="nsr-hint" style={{ margin: 0 }}>
                Gib die E-Mail-Adresse deines Kontos ein. Du bekommst einen Link, mit dem du ein neues Passwort festlegst.
              </p>
            )}
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
              hint={isRegister ? "Du bekommst eine Mail, um die Adresse zu bestätigen." : undefined}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              autoComplete="email"
              inputMode="email"
            />
            {!isForgot && (
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
            )}
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
            {unverified && (
              <button type="button" className="nsr-btn nsr-btn-secondary" onClick={handleResend} disabled={busy}>
                <Send size={16} /> Bestätigungsmail erneut senden
              </button>
            )}

            <button type="submit" className="nsr-btn nsr-btn-primary nsr-btn-wide" disabled={busy}>
              {isForgot ? <Send size={16} /> : isRegister ? <UserPlus size={16} /> : <LogIn size={16} />}
              {busy ? "Einen Moment …" : isForgot ? "Link anfordern" : isRegister ? "Konto erstellen" : "Anmelden"}
            </button>
          </form>

          <div className="nsr-auth-links">
            {isForgot ? (
              <button type="button" className="nsr-link-btn" onClick={() => switchMode("login")}>
                Zurück zur Anmeldung
              </button>
            ) : (
              !isRegister && (
                <button type="button" className="nsr-link-btn" onClick={() => switchMode("forgot")}>
                  Passwort vergessen?
                </button>
              )
            )}
          </div>
          <LegalLinks legal={options?.legal} />
        </div>
      </main>
    </div>
  );
}
