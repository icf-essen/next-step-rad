import React, { useState, useEffect, useRef } from "react";
import { UserPlus, LogIn, Copy, LogOut, Pencil, Check, Trash2, Send, X, Crown } from "lucide-react";
import { AREA_META } from "../constants.js";
import { timeAgo } from "../utils/date.js";
import { MiniBars } from "./MiniBars.jsx";

export function GroupsView({
  me,
  colors,
  groupState,
  onCreateGroup,
  onJoinGroup,
  onLeaveGroup,
  onRenameGroup,
  onRemoveMember,
  onTransferAdmin,
  onSendChat,
}) {
  const [codeInput, setCodeInput] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [showSuccessorPicker, setShowSuccessorPicker] = useState(false);
  const [successorId, setSuccessorId] = useState(null);
  const [busy, setBusy] = useState(false);
  const chatEndRef = useRef(null);

  const myGroup = me.group;
  const group = groupState.group;
  const isAdmin = myGroup?.role === "admin";
  const members = group?.members || [];
  const otherMembers = members.filter((m) => !m.isMe);

  async function withBusy(fn) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  function handleLeaveClick() {
    if (isAdmin && otherMembers.length > 0) {
      setSuccessorId(otherMembers[0].userId);
      setShowSuccessorPicker(true);
    } else if (window.confirm("Willst du die Gruppe wirklich verlassen?")) {
      onLeaveGroup();
    }
  }

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ block: "nearest" });
  }, [groupState.chat.length]);

  useEffect(() => {
    setEditingName(false);
  }, [myGroup?.id]);

  /* ---------------------------- Keine Gruppe ---------------------------- */
  if (!myGroup) {
    return (
      <div className="nsr-view">
        <h2 className="nsr-view-title">Gruppen</h2>
        <p className="nsr-hint" style={{ marginBottom: 18 }}>
          Bildet zusammen eine kleine Gruppe (z. B. mit eurer Smallgroup), teilt eure Bewertungen der Lebensbereiche und
          ermutigt euch gegenseitig bei euren Next Steps.
        </p>

        <div className="nsr-card">
          <p className="nsr-sheet-subhead">Neue Gruppe erstellen</p>
          <p className="nsr-hint">Du leitest die Gruppe und bekommst einen Code, den du teilen kannst.</p>
          <form
            className="nsr-field-row"
            onSubmit={(e) => {
              e.preventDefault();
              withBusy(() => onCreateGroup(newGroupName));
            }}
          >
            <input
              type="text"
              className="nsr-input"
              placeholder="Name, z. B. Hauskreis Mitte"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              maxLength={40}
            />
            <button type="submit" className="nsr-btn nsr-btn-primary" disabled={busy}>
              <UserPlus size={16} /> Erstellen
            </button>
          </form>
        </div>

        <div className="nsr-card">
          <p className="nsr-sheet-subhead">Gruppe beitreten</p>
          <p className="nsr-hint">Gib den Code ein, den du von deiner Gruppe bekommen hast.</p>
          <form
            className="nsr-field-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (codeInput.trim()) withBusy(() => onJoinGroup(codeInput));
            }}
          >
            <input
              type="text"
              className="nsr-input"
              placeholder="z. B. AB12CD"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              maxLength={12}
              autoCapitalize="characters"
              autoComplete="off"
            />
            <button type="submit" className="nsr-btn nsr-btn-secondary" disabled={!codeInput.trim() || busy}>
              <LogIn size={16} /> Beitreten
            </button>
          </form>
        </div>

        <p className="nsr-hint">Du kannst immer nur in einer Gruppe gleichzeitig sein.</p>

        {groupState.error && <p className="nsr-error">{groupState.error}</p>}
      </div>
    );
  }

  /* ---------------------------- In einer Gruppe -------------------------- */
  const groupName = group?.name || myGroup.name;

  return (
    <div className="nsr-view">
      <h2 className="nsr-view-title">Gruppen</h2>

      <div className="nsr-card nsr-code-card">
        <div className="nsr-code-info">
          {editingName ? (
            <form
              className="nsr-inline-edit"
              onSubmit={(e) => {
                e.preventDefault();
                onRenameGroup(nameDraft);
                setEditingName(false);
              }}
            >
              <input
                type="text"
                className="nsr-input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Name der Gruppe"
                maxLength={40}
                autoFocus
              />
              <button type="submit" className="nsr-icon-btn" aria-label="Namen speichern">
                <Check size={17} />
              </button>
            </form>
          ) : (
            <div className="nsr-group-name-row">
              <p className="nsr-group-name">{groupName}</p>
              {isAdmin && (
                <button
                  className="nsr-icon-btn"
                  aria-label="Gruppennamen ändern"
                  onClick={() => {
                    setNameDraft(groupName || "");
                    setEditingName(true);
                  }}
                >
                  <Pencil size={15} />
                </button>
              )}
            </div>
          )}
          <p className="nsr-hint" style={{ margin: "2px 0 0" }}>
            Code: <strong style={{ color: "var(--nsr-ink)", letterSpacing: "0.03em" }}>{myGroup.code}</strong>
          </p>
        </div>
        <div className="nsr-code-actions">
          <button
            className="nsr-icon-btn"
            title="Code kopieren"
            aria-label="Code kopieren"
            onClick={() => {
              if (navigator.clipboard) navigator.clipboard.writeText(myGroup.code);
            }}
          >
            <Copy size={18} />
          </button>
          <button className="nsr-icon-btn" title="Gruppe verlassen" aria-label="Gruppe verlassen" onClick={handleLeaveClick}>
            <LogOut size={18} />
          </button>
        </div>
      </div>

      {showSuccessorPicker && (
        <div className="nsr-overlay" onClick={() => setShowSuccessorPicker(false)}>
          <div className="nsr-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="nsr-sheet-handle" />
            <div className="nsr-sheet-header">
              <h2 className="nsr-sheet-title">Neue Leitung wählen</h2>
              <button className="nsr-icon-btn" onClick={() => setShowSuccessorPicker(false)} aria-label="Schließen">
                <X size={20} />
              </button>
            </div>
            <p className="nsr-sheet-text">
              Du leitest diese Gruppe. Wer soll diese Rolle übernehmen, wenn du sie verlässt?
            </p>
            <div className="nsr-chip-row">
              {otherMembers.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  className={"nsr-chip" + (successorId === m.userId ? " nsr-chip-active" : "")}
                  onClick={() => setSuccessorId(m.userId)}
                >
                  <span>{m.displayName || "Ohne Namen"}</span>
                </button>
              ))}
            </div>
            <div className="nsr-btn-row">
              <button className="nsr-btn nsr-btn-ghost" onClick={() => setShowSuccessorPicker(false)}>
                Abbrechen
              </button>
              <button
                className="nsr-btn nsr-btn-primary"
                disabled={!successorId}
                onClick={() => {
                  setShowSuccessorPicker(false);
                  onLeaveGroup(successorId);
                }}
              >
                Gruppe verlassen
              </button>
            </div>
          </div>
        </div>
      )}

      {groupState.error && <p className="nsr-error">{groupState.error}</p>}

      <p className="nsr-sheet-subhead">Mitglieder</p>
      {!group ? (
        <p className="nsr-hint">Wird geladen …</p>
      ) : (
        <div className="nsr-list">
          {members.map((m) => {
            const c = m.latestCheckin;
            const area = c && AREA_META[c.nextStepArea];
            return (
              <div className="nsr-card nsr-member-row" key={m.userId}>
                <div className="nsr-member-top">
                  <span className="nsr-member-name">
                    {m.displayName || "Ohne Namen"}
                    {m.isMe ? " (du)" : ""}
                    {m.role === "admin" && <span className="nsr-admin-badge">Leitung</span>}
                  </span>
                  <div className="nsr-member-actions">
                    {c && <MiniBars scores={c.scores} colors={colors} />}
                    {isAdmin && !m.isMe && (
                      <>
                        <button
                          className="nsr-icon-btn"
                          title="Leitung übergeben"
                          aria-label={"Leitung an " + (m.displayName || "diese Person") + " übergeben"}
                          onClick={() => {
                            if (window.confirm(`Leitung an ${m.displayName || "diese Person"} übergeben? Du bleibst normales Mitglied.`)) {
                              onTransferAdmin(m.userId);
                            }
                          }}
                        >
                          <Crown size={16} />
                        </button>
                        <button
                          className="nsr-icon-btn"
                          title="Aus der Gruppe entfernen"
                          aria-label={(m.displayName || "Person") + " aus der Gruppe entfernen"}
                          onClick={() => {
                            if (window.confirm("Willst du diese Person wirklich aus der Gruppe entfernen?")) {
                              onRemoveMember(m.userId);
                            }
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {c && c.nextStepText ? (
                  <p className="nsr-member-step">
                    <span style={{ color: colors[c.nextStepArea] || area?.defaultColor }}>{area?.label}:</span>{" "}
                    {c.nextStepText}
                  </p>
                ) : (
                  <p className="nsr-hint" style={{ margin: 0 }}>
                    Noch kein Next Step geteilt.
                  </p>
                )}
              </div>
            );
          })}
          {members.length === 1 && (
            <p className="nsr-empty">Noch niemand hier außer dir. Teile den Code, damit andere beitreten können.</p>
          )}
        </div>
      )}

      <p className="nsr-sheet-subhead" style={{ marginTop: 22 }}>
        Ermutigungs-Chat
      </p>
      <p className="nsr-hint" style={{ marginTop: -6, marginBottom: 10 }}>
        Schreibt euch Bibelverse oder kleine Ermutigungen zu euren Next Steps.
      </p>
      <div className="nsr-card nsr-chat-card">
        <div className="nsr-chat-scroll">
          {groupState.chat.length === 0 && <p className="nsr-hint">Noch keine Nachrichten. Schreib die erste Ermutigung!</p>}
          {groupState.chat.map((m) => (
            <div className={"nsr-chat-msg" + (m.isMine ? " nsr-chat-msg-own" : "")} key={m.id}>
              <div className="nsr-chat-meta">
                <span className="nsr-chat-name">{m.displayName || "Ohne Namen"}</span>
                <span className="nsr-chat-time">{timeAgo(Date.parse(m.createdAt))}</span>
              </div>
              <p>{m.text}</p>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <form
          className="nsr-chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!chatInput.trim()) return;
            onSendChat(chatInput);
            setChatInput("");
          }}
        >
          <input
            type="text"
            className="nsr-input"
            placeholder="Schreib eine Ermutigung …"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            maxLength={2000}
          />
          <button type="submit" className="nsr-icon-btn nsr-icon-btn-accent" aria-label="Senden">
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
