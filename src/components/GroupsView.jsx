import React, { useState, useEffect, useRef } from "react";
import {
  UserPlus,
  LogIn,
  Copy,
  LogOut,
  Pencil,
  Check,
  Trash2,
  Send,
  X,
  Crown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { AREA_META } from "../constants.js";
import { timeAgo } from "../utils/date.js";
import { MiniBars } from "./MiniBars.jsx";

export function GroupsView({
  groups,
  colors,
  selectedGroupId,
  groupState,
  listError,
  onSelectGroup,
  onBack,
  onCreateGroup,
  onJoinGroup,
  onLeaveGroup,
  onRenameGroup,
  onRemoveMember,
  onTransferAdmin,
  onSetParticipation,
  onSendChat,
}) {
  if (selectedGroupId) {
    const summary = groups.find((g) => g.id === selectedGroupId);
    return (
      <GroupDetail
        key={selectedGroupId}
        summary={summary}
        colors={colors}
        groupState={groupState}
        onBack={onBack}
        onLeaveGroup={onLeaveGroup}
        onRenameGroup={onRenameGroup}
        onRemoveMember={onRemoveMember}
        onTransferAdmin={onTransferAdmin}
        onSetParticipation={onSetParticipation}
        onSendChat={onSendChat}
      />
    );
  }
  return (
    <GroupList
      groups={groups}
      error={listError}
      onSelectGroup={onSelectGroup}
      onCreateGroup={onCreateGroup}
      onJoinGroup={onJoinGroup}
    />
  );
}

/* ------------------------------- Übersicht ------------------------------- */

function GroupList({
  groups,
  error,
  onSelectGroup,
  onCreateGroup,
  onJoinGroup,
}) {
  const [codeInput, setCodeInput] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [busy, setBusy] = useState(false);

  async function withBusy(fn) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nsr-view">
      <h2 className="nsr-view-title">Gruppen</h2>

      {groups.length === 0 ? (
        <p className="nsr-hint" style={{ marginBottom: 18 }}>
          Bildet zusammen eine kleine Gruppe (z. B. mit eurer Smallgroup), teilt
          eure Bewertungen der Lebensbereiche und ermutigt euch gegenseitig bei
          euren Next Steps.
        </p>
      ) : (
        <div className="nsr-group-list">
          {groups.map((g) => (
            <button
              type="button"
              key={g.id}
              className="nsr-card nsr-group-item"
              onClick={() => onSelectGroup(g.id)}
              aria-label={"Gruppe " + g.name + " öffnen"}
            >
              <div className="nsr-group-item-main">
                <p className="nsr-group-item-name">{g.name}</p>
                <div className="nsr-group-item-meta">
                  {g.managed && <span className="nsr-team-badge">Team</span>}
                  {g.optedOut && (
                    <span className="nsr-optout-badge">Nicht dabei</span>
                  )}
                  {g.role === "admin" && !g.optedOut && (
                    <span className="nsr-admin-badge">Leitung</span>
                  )}
                  <span>
                    {g.memberCount}{" "}
                    {g.memberCount === 1 ? "Mitglied" : "Mitglieder"}
                  </span>
                </div>
              </div>
              <ChevronRight size={18} className="nsr-drawer-chevron" />
            </button>
          ))}
        </div>
      )}

      <div className="nsr-card">
        <p className="nsr-sheet-subhead">Neue Gruppe erstellen</p>
        <p className="nsr-hint">
          Du leitest die Gruppe und bekommst einen Code, den du teilen kannst.
        </p>
        <form
          className="nsr-field-row"
          onSubmit={(e) => {
            e.preventDefault();
            withBusy(async () => {
              await onCreateGroup(newGroupName);
              setNewGroupName("");
            });
          }}
        >
          <input
            type="text"
            className="nsr-input"
            placeholder="Name, z. B. Hauskreis Mitte"
            aria-label="Name der neuen Gruppe"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            maxLength={40}
          />
          <button
            type="submit"
            className="nsr-btn nsr-btn-primary"
            disabled={busy}
          >
            <UserPlus size={16} /> Erstellen
          </button>
        </form>
      </div>

      <div className="nsr-card">
        <p className="nsr-sheet-subhead">Gruppe beitreten</p>
        <p className="nsr-hint">
          Gib den Code ein, den du von deiner Gruppe bekommen hast.
        </p>
        <form
          className="nsr-field-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!codeInput.trim()) return;
            withBusy(async () => {
              await onJoinGroup(codeInput);
              setCodeInput("");
            });
          }}
        >
          <input
            type="text"
            className="nsr-input"
            placeholder="z. B. AB12CD"
            aria-label="Gruppen-Code"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            maxLength={12}
            autoCapitalize="characters"
            autoComplete="off"
          />
          <button
            type="submit"
            className="nsr-btn nsr-btn-secondary"
            disabled={!codeInput.trim() || busy}
          >
            <LogIn size={16} /> Beitreten
          </button>
        </form>
      </div>

      {error && <p className="nsr-error">{error}</p>}
    </div>
  );
}

/* -------------------------------- Detail --------------------------------- */

function GroupDetail({
  summary,
  colors,
  groupState,
  onBack,
  onLeaveGroup,
  onRenameGroup,
  onRemoveMember,
  onTransferAdmin,
  onSetParticipation,
  onSendChat,
}) {
  const [chatInput, setChatInput] = useState("");
  const [participationBusy, setParticipationBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [showSuccessorPicker, setShowSuccessorPicker] = useState(false);
  const [successorId, setSuccessorId] = useState(null);
  const chatEndRef = useRef(null);

  const group = groupState.group;
  const managed = group ? group.managed : !!summary?.managed;
  const isAdmin = (group ? group.role : summary?.role) === "admin";
  const canManage = isAdmin && !managed;
  const members = group?.members || [];
  const otherMembers = members.filter((m) => !m.isMe);
  const otherAdmins = otherMembers.filter((m) => m.role === "admin");
  const groupName = group?.name || summary?.name || "";
  const code = group?.code || summary?.code;
  const optedOut = group ? !!group.optedOut : !!summary?.optedOut;

  async function toggleParticipation(notParticipating) {
    if (
      notParticipating &&
      !window.confirm(
        "An dieser Gruppe nicht mehr teilnehmen? Andere sehen dich dort nicht mehr, und du siehst weder Mitglieder noch Chat. Du kannst das jederzeit rückgängig machen.",
      )
    ) {
      return;
    }
    setParticipationBusy(true);
    try {
      await onSetParticipation(!notParticipating);
    } finally {
      setParticipationBusy(false);
    }
  }

  useEffect(() => {
    if (chatEndRef.current)
      chatEndRef.current.scrollIntoView({ block: "nearest" });
  }, [groupState.chat.length]);

  function handleLeaveClick() {
    // Nachfolger nur nötig, wenn man die letzte Leitung ist und noch jemand bleibt.
    if (isAdmin && otherAdmins.length === 0 && otherMembers.length > 0) {
      setSuccessorId(otherMembers[0].userId);
      setShowSuccessorPicker(true);
    } else if (window.confirm("Willst du die Gruppe wirklich verlassen?")) {
      onLeaveGroup();
    }
  }

  return (
    <div className="nsr-view">
      <button type="button" className="nsr-back-btn" onClick={onBack}>
        <ChevronLeft size={16} /> Alle Gruppen
      </button>

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
                aria-label="Name der Gruppe"
                maxLength={40}
                autoFocus
              />
              <button
                type="submit"
                className="nsr-icon-btn"
                aria-label="Namen speichern"
              >
                <Check size={17} />
              </button>
            </form>
          ) : (
            <div className="nsr-group-name-row">
              <p className="nsr-group-name">{groupName}</p>
              {canManage && (
                <button
                  className="nsr-icon-btn"
                  aria-label="Gruppennamen ändern"
                  onClick={() => {
                    setNameDraft(groupName);
                    setEditingName(true);
                  }}
                >
                  <Pencil size={15} />
                </button>
              )}
            </div>
          )}
          {managed ? (
            <p className="nsr-managed-note">
              <span className="nsr-team-badge">Team</span> Mitglieder und
              Leitung werden über Authentik gepflegt.
            </p>
          ) : (
            code && (
              <p className="nsr-hint" style={{ margin: "2px 0 0" }}>
                Code:{" "}
                <strong
                  style={{ color: "var(--nsr-ink)", letterSpacing: "0.03em" }}
                >
                  {code}
                </strong>
              </p>
            )
          )}
        </div>
        {!managed && (
          <div className="nsr-code-actions">
            {code && (
              <button
                className="nsr-icon-btn"
                title="Code kopieren"
                aria-label="Code kopieren"
                onClick={() => {
                  if (navigator.clipboard) navigator.clipboard.writeText(code);
                }}
              >
                <Copy size={18} />
              </button>
            )}
            <button
              className="nsr-icon-btn"
              title="Gruppe verlassen"
              aria-label="Gruppe verlassen"
              onClick={handleLeaveClick}
            >
              <LogOut size={18} />
            </button>
          </div>
        )}
      </div>

      {managed && (
        <label className="nsr-card nsr-checkbox-row nsr-participation">
          <input
            type="checkbox"
            checked={optedOut}
            disabled={participationBusy}
            onChange={(e) => toggleParticipation(e.target.checked)}
          />
          <span>
            Ich möchte an dieser Gruppe nicht teilnehmen
            <small className="nsr-hint">
              Solange der Haken gesetzt ist, erscheinst du hier nicht und siehst
              weder Mitglieder noch Chat. Die Einstellung bleibt auch nach einer
              neuen Anmeldung bestehen.
            </small>
          </span>
        </label>
      )}

      {showSuccessorPicker && (
        <div
          className="nsr-overlay"
          onClick={() => setShowSuccessorPicker(false)}
        >
          <div className="nsr-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="nsr-sheet-handle" />
            <div className="nsr-sheet-header">
              <h2 className="nsr-sheet-title">Neue Leitung wählen</h2>
              <button
                className="nsr-icon-btn"
                onClick={() => setShowSuccessorPicker(false)}
                aria-label="Schließen"
              >
                <X size={20} />
              </button>
            </div>
            <p className="nsr-sheet-text">
              Du leitest diese Gruppe. Wer soll diese Rolle übernehmen, wenn du
              sie verlässt?
            </p>
            <div className="nsr-chip-row">
              {otherMembers.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  className={
                    "nsr-chip" +
                    (successorId === m.userId ? " nsr-chip-active" : "")
                  }
                  onClick={() => setSuccessorId(m.userId)}
                >
                  <span>{m.displayName || "Ohne Namen"}</span>
                </button>
              ))}
            </div>
            <div className="nsr-btn-row">
              <button
                className="nsr-btn nsr-btn-ghost"
                onClick={() => setShowSuccessorPicker(false)}
              >
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

      {optedOut ? (
        <p className="nsr-empty">
          Du nimmst an dieser Gruppe gerade nicht teil. Entferne den Haken, um
          wieder dabei zu sein.
        </p>
      ) : (
        <>
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
                        {m.role === "admin" && (
                          <span className="nsr-admin-badge">Leitung</span>
                        )}
                      </span>
                      <div className="nsr-member-actions">
                        {c && <MiniBars scores={c.scores} colors={colors} />}
                        {canManage && !m.isMe && (
                          <>
                            {m.role !== "admin" && (
                              <button
                                className="nsr-icon-btn"
                                title="Leitung übergeben"
                                aria-label={
                                  "Leitung an " +
                                  (m.displayName || "diese Person") +
                                  " übergeben"
                                }
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Leitung an ${m.displayName || "diese Person"} übergeben? Du bleibst normales Mitglied.`,
                                    )
                                  ) {
                                    onTransferAdmin(m.userId);
                                  }
                                }}
                              >
                                <Crown size={16} />
                              </button>
                            )}
                            <button
                              className="nsr-icon-btn"
                              title="Aus der Gruppe entfernen"
                              aria-label={
                                (m.displayName || "Person") +
                                " aus der Gruppe entfernen"
                              }
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Willst du diese Person wirklich aus der Gruppe entfernen?",
                                  )
                                ) {
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
                        <span
                          style={{
                            color: colors[c.nextStepArea] || area?.defaultColor,
                          }}
                        >
                          {area?.label}:
                        </span>{" "}
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
              {members.length === 1 && !managed && (
                <p className="nsr-empty">
                  Noch niemand hier außer dir. Teile den Code, damit andere
                  beitreten können.
                </p>
              )}
            </div>
          )}

          <p className="nsr-sheet-subhead" style={{ marginTop: 22 }}>
            Ermutigungs-Chat
          </p>
          <p className="nsr-hint" style={{ marginTop: -6, marginBottom: 10 }}>
            Schreibt euch Bibelverse oder kleine Ermutigungen zu euren Next
            Steps.
          </p>
          <div className="nsr-card nsr-chat-card">
            <div className="nsr-chat-scroll">
              {groupState.chat.length === 0 && (
                <p className="nsr-hint">
                  Noch keine Nachrichten. Schreib die erste Ermutigung!
                </p>
              )}
              {groupState.chat.map((m) => (
                <div
                  className={
                    "nsr-chat-msg" + (m.isMine ? " nsr-chat-msg-own" : "")
                  }
                  key={m.id}
                >
                  <div className="nsr-chat-meta">
                    <span className="nsr-chat-name">
                      {m.displayName || "Ohne Namen"}
                    </span>
                    <span className="nsr-chat-time">
                      {timeAgo(Date.parse(m.createdAt))}
                    </span>
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
                aria-label="Nachricht"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                maxLength={2000}
              />
              <button
                type="submit"
                className="nsr-icon-btn nsr-icon-btn-accent"
                aria-label="Senden"
              >
                <Send size={18} />
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
