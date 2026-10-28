import React, { useEffect, useId, useState } from "react";
import { ShieldAlert, KeyRound } from "lucide-react";
import { elevate, totpConfirm, totpSetup } from "../apiClient.js";

/**
 * Break-Glass für lokale Admins: Authenticator einrichten bzw. mit Code die
 * Verwaltung freischalten. Nur aus dem internen Netz möglich.
 */
export function BreakGlassView({ me, onMeChanged }) {
  const local = me.localAdmin;
  const id = useId();
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState(null); // { secret, otpauthUrl }
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!setup) return;
    let cancelled = false;
    // QR-Code erst bei Bedarf laden, damit die App für alle anderen klein bleibt.
    import("qrcode").then(({ default: QRCode }) =>
      QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 220 }).then((url) => !cancelled && setQr(url))
    );
    return () => {
      cancelled = true;
    };
  }, [setup]);

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  const codeField = (
    <div className="nsr-field">
      <label htmlFor={id + "-code"}>6-stelliger Code aus der Authenticator-App</label>
      <input
        id={id + "-code"}
        className="nsr-input nsr-code-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        required
      />
    </div>
  );

  return (
    <div className="nsr-view">
      <h2 className="nsr-view-title">Verwaltung</h2>
      <p className="nsr-auth-notice nsr-breakglass-note">
        <ShieldAlert size={18} />
        <span>
          Notfallzugang (Break-Glass): Du bist lokaler Admin. Die Verwaltung wird nur für diese Sitzung und höchstens
          einige Stunden freigeschaltet. Jede Freischaltung wird protokolliert.
        </span>
      </p>

      {!local.fromInternalNetwork ? (
        <p className="nsr-empty">
          Mit einem lokalen Konto lässt sich die Verwaltung nur aus dem internen Netz der Gemeinde freischalten.
          Melde dich von außen bitte über dein ICF-Konto an.
        </p>
      ) : !local.totpEnabled ? (
        <div className="nsr-card nsr-auth-form">
          <p className="nsr-sheet-subhead" style={{ margin: 0 }}>
            Authenticator-App einrichten
          </p>
          {!setup ? (
            <form
              className="nsr-auth-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => setSetup(await totpSetup(password)));
              }}
            >
              <p className="nsr-hint" style={{ margin: 0 }}>
                Einmalig: Bestätige dein Passwort, dann scannst du einen QR-Code mit einer Authenticator-App (z. B. in
                Vaultwarden, Aegis oder Google Authenticator).
              </p>
              <div className="nsr-field">
                <label htmlFor={id + "-pw"}>Dein Passwort</label>
                <input
                  id={id + "-pw"}
                  type="password"
                  className="nsr-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              {error && <p className="nsr-error" role="alert">{error}</p>}
              <button type="submit" className="nsr-btn nsr-btn-primary" disabled={busy}>
                Weiter
              </button>
            </form>
          ) : (
            <form
              className="nsr-auth-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => onMeChanged(await totpConfirm(code)));
              }}
            >
              <div className="nsr-qr">{qr ? <img src={qr} alt="QR-Code für die Authenticator-App" width="220" height="220" /> : null}</div>
              <p className="nsr-hint" style={{ margin: 0 }}>
                Kein Scannen möglich? Schlüssel manuell eingeben:
              </p>
              <code className="nsr-secret" data-testid="totp-secret">{setup.secret}</code>
              {codeField}
              {error && <p className="nsr-error" role="alert">{error}</p>}
              <button type="submit" className="nsr-btn nsr-btn-primary" disabled={busy || code.length !== 6}>
                Einrichtung abschließen
              </button>
            </form>
          )}
        </div>
      ) : (
        <form
          className="nsr-card nsr-auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => onMeChanged(await elevate(code)));
          }}
        >
          {codeField}
          {error && <p className="nsr-error" role="alert">{error}</p>}
          <button type="submit" className="nsr-btn nsr-btn-primary" disabled={busy || code.length !== 6}>
            <KeyRound size={16} /> Verwaltung freischalten
          </button>
        </form>
      )}
    </div>
  );
}
