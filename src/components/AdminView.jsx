import React, { useState } from "react";
import { Search, Link2, Copy, Check } from "lucide-react";
import { searchUsers, createResetLink } from "../apiClient.js";

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
                  <span>seit {new Date(u.createdAt).toLocaleDateString("de-DE")}</span>
                </div>
                {u.hasPassword ? (
                  <button className="nsr-btn nsr-btn-secondary" onClick={() => handleReset(u)}>
                    <Link2 size={16} /> Link zum Zurücksetzen
                  </button>
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
