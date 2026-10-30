import React, { useEffect, useRef, useState } from "react";
import { verifyEmail } from "../apiClient.js";

/** Bestätigungslink (#verify=…) einlösen; danach ist man angemeldet. */
export function VerifyEmailView({ token, onVerified, onCancel }) {
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    // StrictMode ruft Effekte doppelt auf; der Link ist aber nur einmal gültig.
    if (started.current) return;
    started.current = true;
    verifyEmail(token)
      .then(onVerified)
      .catch((e) => setError(e.message));
  }, [token, onVerified]);

  return (
    <div className="nsr-app">
      <header className="nsr-topbar">
        <span className="nsr-topbar-title nsr-auth-brand">Next Step</span>
      </header>
      <main className="nsr-main">
        <div className="nsr-view nsr-auth">
          <h2 className="nsr-view-title">E-Mail bestätigen</h2>
          {error ? (
            <>
              <p className="nsr-error" role="alert">
                {error}
              </p>
              <p className="nsr-hint">
                Melde dich mit E-Mail und Passwort an – dort kannst du dir eine neue Bestätigungsmail schicken lassen.
              </p>
              <button className="nsr-btn nsr-btn-primary nsr-btn-wide" onClick={onCancel}>
                Zur Anmeldung
              </button>
            </>
          ) : (
            <p className="nsr-hint">Einen Moment, deine Adresse wird bestätigt …</p>
          )}
        </div>
      </main>
    </div>
  );
}
