import React, { useState } from "react";
import { Search, Link2, Copy, Check, ShieldCheck, MailCheck } from "lucide-react";
import { searchUsers, createResetLink, updateUser } from "../apiClient.js";

/** Verwaltung: Konten suchen und Links zum Zurücksetzen des Passworts erzeugen. */
export function AdminView() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [links, setLinks] = useState({}); // userId -> { url, expiresAt }
  const [copied, setCopied] = useState(null);

  async function handleSearch(e) {
    e.preventDefault();
    if (q.trim().length < 2) return setError("Bitte mindestens 2 Zeichen eingeben.");
    setBusy(true);
    setError("");
    try {
      setResults(await searchUsers(q.trim()));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function handleReset(user) {
    if (!window.confirm(`Link zum Zurücksetzen des Passworts für ${user.email} erzeugen? Ältere Links werden ungültig.`)) return;
    setError("");
    try {
      const link = await createResetLink(user.id);
      setLinks((prev) => ({ ...prev, [user.id]: link }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function patchUser(user, patch, question) {
    if (question && !window.confirm(question)) return;
    setError("");
    try {
      const updated = await updateUser(user.id, patch);
      setResults((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...updated } : u)));
    } catch (err) {
      setError(err.message);
    }
  }

  function copy(userId, url) {
    if (navigator.clipboard) navigator.clipboard.writeText(url);
    setCopied(userId);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="nsr-view">
      <h2 className="nsr-view-title">Verwaltung</h2>
      <p className="nsr-hint" style={{ marginBottom: 14 }}>
        Hat jemand das Passwort vergessen, erzeugst du hier einen Link, mit dem die Person selbst ein neues festlegt.
        Gib den Link nur persönlich weiter (z. B. per Signal). Er gilt einmalig und ist zeitlich begrenzt.
      </p>

      <form className="nsr-card nsr-field-row" style={{ marginTop: 0 }} onSubmit={handleSearch}>
        <input
          type="search"
          className="nsr-input"
          placeholder="E-Mail oder Name"
          aria-label="Konto suchen"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={100}
        />
        <button type="submit" className="nsr-btn nsr-btn-primary" disabled={busy}>
          <Search size={16} /> Suchen
        </button>
      </form>

      {error && (
        <p className="nsr-error" role="alert">
          {error}
        </p>
      )}

      {results && results.length === 0 && <p className="nsr-empty">Kein Konto gefunden.</p>}

      {results && results.length > 0 && (
        <div className="nsr-list">
          {results.map((u) => {
            const link = links[u.id];
            return (
              <div className="nsr-card nsr-admin-user" key={u.id}>
                <p className="nsr-admin-user-name">{u.displayName || "Ohne Namen"}</p>
                <p className="nsr-hint" style={{ margin: "0 0 8px" }}>
                  {u.email}
                </p>
                <div className="nsr-group-item-meta" style={{ marginBottom: 10 }}>
                  {u.hasPassword && <span className="nsr-team-badge">Passwort</span>}
                  {u.ssoLinked && <span className="nsr-team-badge">ICF-Konto</span>}
                  {!u.emailVerified && <span className="nsr-optout-badge">nicht bestätigt</span>}
                  {u.localAdmin && <span className="nsr-admin-badge">Lokaler Admin</span>}
                  {u.localAdmin && <span className="nsr-team-badge">{u.totpEnabled ? "TOTP aktiv" : "TOTP fehlt"}</span>}
                  <span>seit {new Date(u.createdAt).toLocaleDateString("de-DE")}</span>
                </div>
                {u.hasPassword ? (
                  <div className="nsr-btn-row nsr-admin-actions">
                    <button className="nsr-btn nsr-btn-secondary" onClick={() => handleReset(u)}>
                      <Link2 size={16} /> Link zum Zurücksetzen
                    </button>
                    {!u.emailVerified && (
                      <button
                        className="nsr-btn nsr-btn-ghost"
                        onClick={() =>
                          patchUser(u, { emailVerified: true }, `E-Mail-Adresse von ${u.email} als bestätigt markieren?`)
                        }
                      >
                        <MailCheck size={16} /> E-Mail bestätigen
                      </button>
                    )}
                    <button
                      className={"nsr-btn " + (u.localAdmin ? "nsr-btn-danger" : "nsr-btn-ghost")}
                      onClick={() =>
                        patchUser(
                          u,
                          { localAdmin: !u.localAdmin },
                          u.localAdmin
                            ? `${u.email} die Rolle „lokaler Admin“ entziehen? Laufende Freischaltungen enden sofort.`
                            : `${u.email} zum lokalen Admin (Break-Glass) machen? Die Person kann dann ohne Authentik – aus dem internen Netz und mit Authenticator-Code – die Verwaltung öffnen.`
                        )
                      }
                    >
                      <ShieldCheck size={16} /> {u.localAdmin ? "Lokalen Admin entziehen" : "Zum lokalen Admin machen"}
                    </button>
                  </div>
                ) : (
                  <p className="nsr-hint" style={{ margin: 0 }}>
                    Kein Passwort – meldet sich über das ICF-Konto an.
                  </p>
                )}
                {link && (
                  <div className="nsr-reset-link">
                    <code>{link.url}</code>
                    <button
                      className="nsr-icon-btn"
                      aria-label="Link kopieren"
                      title="Link kopieren"
                      onClick={() => copy(u.id, link.url)}
                    >
                      {copied === u.id ? <Check size={17} /> : <Copy size={17} />}
                    </button>
                    <small className="nsr-hint">
                      Gültig bis {new Date(link.expiresAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}{" "}
                      Uhr, nur einmal verwendbar.
                    </small>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
