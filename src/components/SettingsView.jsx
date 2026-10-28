import React, { useState, useEffect } from "react";
import { RotateCcw, LogOut, KeyRound, CheckCircle2 } from "lucide-react";
import { AREA_ORDER, AREA_META } from "../constants.js";

const MIN_PASSWORD = 10;

export function SettingsView({
  me,
  colors,
  onUpdateName,
  onUpdateColor,
  onResetColors,
  onResetData,
  onChangePassword,
  onDeleteAccount,
  onLinkSso,
  onUnlinkSso,
  ssoAvailable,
  onLogout,
}) {
  const [name, setName] = useState(me.displayName || "");

  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwNew2, setPwNew2] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const [delOpen, setDelOpen] = useState(false);
  const [delPassword, setDelPassword] = useState("");
  const [delError, setDelError] = useState("");
  const [delBusy, setDelBusy] = useState(false);

  useEffect(() => {
    setName(me.displayName || "");
  }, [me.displayName]);

  async function submitPassword(e) {
    e.preventDefault();
    setPwError("");
    if (pwNew.length < MIN_PASSWORD) return setPwError(`Mindestens ${MIN_PASSWORD} Zeichen.`);
    if (pwNew !== pwNew2) return setPwError("Die neuen Passwörter stimmen nicht überein.");
    setPwBusy(true);
    try {
      await onChangePassword(pwCurrent, pwNew);
      setPwOpen(false);
      setPwCurrent("");
      setPwNew("");
      setPwNew2("");
    } catch (err) {
      setPwError(err.message);
    }
    setPwBusy(false);
  }

  async function submitDelete(e) {
    e.preventDefault();
    setDelError("");
    if (!window.confirm("Konto mit allen Bewertungen endgültig löschen? Das lässt sich nicht rückgängig machen.")) return;
    setDelBusy(true);
    try {
      // Konten ohne Passwort (nur ICF-Konto) bestätigen mit dem Wort „LÖSCHEN“.
      await onDeleteAccount(me.hasPassword ? { password: delPassword } : { confirm: delPassword });
    } catch (err) {
      setDelError(err.message);
      setDelBusy(false);
    }
  }

  return (
    <div className="nsr-view">
      <h2 className="nsr-view-title">Einstellungen</h2>

      <div className="nsr-card">
        <p className="nsr-sheet-subhead">Dein Name</p>
        <p className="nsr-hint">Wird in deiner Gruppe angezeigt, damit andere dich erkennen.</p>
        <input
          type="text"
          className="nsr-input"
          value={name}
          placeholder="z. B. Julia"
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onUpdateName(name)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </div>

      <div className="nsr-card">
        <div className="nsr-row-between">
          <p className="nsr-sheet-subhead" style={{ margin: 0 }}>
            Farben des Rads
          </p>
          <button className="nsr-link-btn" onClick={onResetColors}>
            <RotateCcw size={14} /> Zurücksetzen
          </button>
        </div>
        {AREA_ORDER.map((key) => {
          const meta = AREA_META[key];
          const Icon = meta.icon;
          return (
            <div className="nsr-color-row" key={key}>
              <Icon size={17} strokeWidth={2} color={colors[key] || meta.defaultColor} />
              <span>{meta.label}</span>
              <input
                type="color"
                aria-label={"Farbe für " + meta.label}
                value={colors[key] || meta.defaultColor}
                onChange={(e) => onUpdateColor(key, e.target.value)}
              />
            </div>
          );
        })}
      </div>

      <div className="nsr-card">
        <p className="nsr-sheet-subhead">Konto</p>
        <p className="nsr-hint" style={{ marginBottom: 12 }}>
          Angemeldet als <strong style={{ color: "var(--nsr-ink)" }}>{me.email}</strong>. Deine Daten werden mit deinem
          Konto gespeichert und sind auf jedem Gerät verfügbar, auf dem du dich anmeldest.
        </p>

        {me.ssoLinked ? (
          <div style={{ marginBottom: 14 }}>
            <p className="nsr-sso-status">
              <CheckCircle2 size={17} color="var(--nsr-accent)" /> Mit deinem ICF-Konto verbunden
            </p>
            {me.hasPassword ? (
              <button className="nsr-link-btn" onClick={onUnlinkSso}>
                Verbindung trennen
              </button>
            ) : (
              <p className="nsr-hint" style={{ margin: 0 }}>
                Du meldest dich ausschließlich über dein ICF-Konto an.
              </p>
            )}
          </div>
        ) : (
          ssoAvailable && (
            <div style={{ marginBottom: 14 }}>
              <p className="nsr-hint" style={{ marginTop: 0 }}>
                Verbinde dein ICF-Konto, um dich künftig auch darüber anzumelden und deine Teams zu sehen.
              </p>
              <button className="nsr-btn nsr-btn-secondary" onClick={onLinkSso}>
                <KeyRound size={16} /> ICF-Konto verbinden
              </button>
            </div>
          )
        )}

        {!pwOpen ? (
          <div className="nsr-btn-row">
            {me.hasPassword && (
              <button className="nsr-btn nsr-btn-secondary" onClick={() => setPwOpen(true)}>
                Passwort ändern
              </button>
            )}
            <button className="nsr-btn nsr-btn-ghost" onClick={onLogout}>
              <LogOut size={16} /> Abmelden
            </button>
          </div>
        ) : (
          <form className="nsr-auth-form" onSubmit={submitPassword}>
            <label className="nsr-field">
              <span>Aktuelles Passwort</span>
              <input
                type="password"
                className="nsr-input"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
            <label className="nsr-field">
              <span>Neues Passwort</span>
              <input
                type="password"
                className="nsr-input"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
                required
                minLength={MIN_PASSWORD}
                maxLength={200}
                autoComplete="new-password"
              />
            </label>
            <label className="nsr-field">
              <span>Neues Passwort wiederholen</span>
              <input
                type="password"
                className="nsr-input"
                value={pwNew2}
                onChange={(e) => setPwNew2(e.target.value)}
                required
                maxLength={200}
                autoComplete="new-password"
              />
            </label>
            {pwError && <p className="nsr-error">{pwError}</p>}
            <div className="nsr-btn-row">
              <button type="button" className="nsr-btn nsr-btn-ghost" onClick={() => setPwOpen(false)}>
                Abbrechen
              </button>
              <button type="submit" className="nsr-btn nsr-btn-primary" disabled={pwBusy}>
                {pwBusy ? "Einen Moment …" : "Speichern"}
              </button>
            </div>
          </form>
        )}

      </div>

      <div className="nsr-card">
        <p className="nsr-sheet-subhead">Daten</p>
        <p className="nsr-hint">Löscht alle deine gespeicherten Wochenbewertungen und Next Steps unwiderruflich.</p>
        <button className="nsr-btn nsr-btn-danger" onClick={onResetData}>
          Alle Bewertungen löschen
        </button>

        <p className="nsr-hint" style={{ marginTop: 18 }}>
          Löscht dein Konto mit allen Bewertungen, Nachrichten und Einstellungen endgültig.
        </p>
        {!delOpen ? (
          <button className="nsr-btn nsr-btn-danger" onClick={() => setDelOpen(true)}>
            Konto löschen
          </button>
        ) : (
          <form className="nsr-auth-form" onSubmit={submitDelete}>
            <label className="nsr-field">
              <span>{me.hasPassword ? "Zur Bestätigung dein Passwort" : "Zur Bestätigung „LÖSCHEN“ eingeben"}</span>
              <input
                type={me.hasPassword ? "password" : "text"}
                className="nsr-input"
                value={delPassword}
                onChange={(e) => setDelPassword(e.target.value)}
                required
                autoComplete={me.hasPassword ? "current-password" : "off"}
              />
            </label>
            {delError && <p className="nsr-error">{delError}</p>}
            <div className="nsr-btn-row">
              <button type="button" className="nsr-btn nsr-btn-ghost" onClick={() => setDelOpen(false)}>
                Abbrechen
              </button>
              <button type="submit" className="nsr-btn nsr-btn-danger" disabled={delBusy}>
                {delBusy ? "Wird gelöscht …" : "Endgültig löschen"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
