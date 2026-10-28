import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Menu,
  X,
  Home as HomeIcon,
  History as HistoryIcon,
  Settings as SettingsIcon,
  Users,
  ChevronRight,
  ChevronDown,
  ShieldCheck,
} from "lucide-react";
import * as api from "./apiClient.js";
import { AREA_ORDER, AREA_META, VERSE } from "./constants.js";
import { getISOWeekId } from "./utils/date.js";
import { ssoMessage } from "./utils/sso.js";
import { Wheel } from "./components/Wheel.jsx";
import { InfoSheet } from "./components/InfoSheet.jsx";
import { CheckinSheet } from "./components/CheckinSheet.jsx";
import { HistoryView } from "./components/HistoryView.jsx";
import { SettingsView } from "./components/SettingsView.jsx";
import { GroupsView } from "./components/GroupsView.jsx";
import { AuthView } from "./components/AuthView.jsx";
import { AdminView } from "./components/AdminView.jsx";
import { ResetPasswordView } from "./components/ResetPasswordView.jsx";
import { LegalLinks } from "./components/LegalLinks.jsx";

const GROUP_POLL_MS = 8000;
const EMPTY_GROUP = { group: null, chat: [], loading: false, error: "" };

function defaultColors() {
  const colors = {};
  AREA_ORDER.forEach((k) => (colors[k] = AREA_META[k].defaultColor));
  return colors;
}

/** Token aus einem Link zum Zurücksetzen des Passworts (#reset=…) auslesen. */
function readResetToken() {
  const m = window.location.hash.match(/^#reset=([A-Za-z0-9_-]{20,100})$/);
  return m ? m[1] : null;
}

function clearHash() {
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

/** Rückmeldung aus dem SSO-Ablauf (?sso=… / ?sso_error=…) einmalig auslesen und aus der Adresse entfernen. */
function takeSsoResult() {
  const params = new URLSearchParams(window.location.search);
  const result = { ok: params.get("sso"), error: params.get("sso_error") };
  if (result.ok || result.error) {
    params.delete("sso");
    params.delete("sso_error");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : "") + window.location.hash);
  }
  return result;
}

export default function NextStepRad() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authOptions, setAuthOptions] = useState({ sso: false, ssoLabel: null, legal: null });
  const [resetToken, setResetToken] = useState(readResetToken);
  const [ssoError, setSsoError] = useState("");
  const [me, setMe] = useState(null);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoArea, setInfoArea] = useState(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinStep, setCheckinStep] = useState(1);
  const [tempScores, setTempScores] = useState({});
  const [nextStepArea, setNextStepArea] = useState(null);
  const [nextStepText, setNextStepText] = useState("");
  const [shareWithGroup, setShareWithGroup] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkinError, setCheckinError] = useState("");
  const [toast, setToast] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [groupState, setGroupState] = useState(EMPTY_GROUP);
  const [groupsError, setGroupsError] = useState("");
  const [showAnleitung, setShowAnleitung] = useState(false);
  const [colors, setColors] = useState(defaultColors());

  const meRef = useRef(me);
  useEffect(() => {
    meRef.current = me;
  }, [me]);
  const groupStateRef = useRef(groupState);
  useEffect(() => {
    groupStateRef.current = groupState;
  }, [groupState]);

  // Reset-Link in einem bereits offenen Tab: Nur das Fragment ändert sich, kein Neuladen.
  useEffect(() => {
    const onHash = () => setResetToken(readResetToken());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  /* --- Sitzung prüfen und Daten laden --- */
  const applyMe = useCallback((data) => {
    setMe(data);
    setColors({ ...defaultColors(), ...(data?.colors || {}) });
  }, []);

  const signOutLocally = useCallback(() => {
    setMe(null);
    setEntries([]);
    setEntriesLoaded(false);
    setSelectedGroupId(null);
    setGroupState(EMPTY_GROUP);
    setView("home");
    setMenuOpen(false);
    setCheckinOpen(false);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      applyMe(await api.getMe());
    } catch {
      /* 401 wird zentral behandelt, sonst alten Stand behalten */
    }
  }, [applyMe]);

  useEffect(() => {
    // Läuft eine Sitzung ab, landet man wieder auf der Anmeldeseite.
    api.setUnauthorizedHandler(() => {
      if (meRef.current) {
        signOutLocally();
        setToast("Bitte melde dich erneut an.");
      }
    });
    const sso = takeSsoResult();
    (async () => {
      api.getAuthOptions().then(setAuthOptions).catch(() => {});
      let current = null;
      try {
        current = await api.getMe();
        applyMe(current);
      } catch (e) {
        if (e.status !== 401) setLoadError(e.message);
      }
      if (sso.error) {
        // Angemeldet (z. B. beim Verbinden) als Hinweis, sonst auf der Anmeldeseite.
        if (current) setToast(ssoMessage(sso.error));
        else setSsoError(ssoMessage(sso.error));
      } else if (sso.ok === "linked") {
        setView("settings");
        setToast("Dein ICF-Konto ist jetzt verbunden.");
      }
      setAuthChecked(true);
    })();
  }, [applyMe, signOutLocally]);

  useEffect(() => {
    if (!me || entriesLoaded) return;
    api
      .getEntries()
      .then((list) => {
        setEntries(list);
        setEntriesLoaded(true);
      })
      .catch((e) => setLoadError(e.message));
  }, [me, entriesLoaded]);

  const currentWeekId = getISOWeekId();
  const hasCheckedInThisWeek = entries.some((e) => e.weekId === currentWeekId);
  const latestScores = entries.length > 0 ? entries[entries.length - 1].scores : {};
  const myGroups = me?.groups || [];
  const inAnyGroup = myGroups.length > 0;

  /* --- Toast automatisch ausblenden (längere Texte bleiben länger stehen) --- */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), Math.max(2600, toast.length * 55));
    return () => clearTimeout(t);
  }, [toast]);

  /* --- Gruppen: Übersicht beim Öffnen aktualisieren --- */
  useEffect(() => {
    if (view === "groups" && me) refreshMe();
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  /* --- Ausgewählte Gruppe laden + Polling --- */
  const loadGroupData = useCallback(
    async (groupId) => {
      try {
        const group = await api.getGroup(groupId);
        if (!group) {
          // Nicht (mehr) Mitglied, z. B. von der Leitung entfernt oder aus dem Team in Authentik.
          setSelectedGroupId(null);
          setGroupState(EMPTY_GROUP);
          setToast("Du bist nicht mehr in dieser Gruppe.");
          refreshMe();
          return;
        }
        if (group.optedOut) {
          // Abgewählte Team-Gruppe: keine Mitglieder, kein Chat.
          setGroupState({ group, chat: [], loading: false, error: "" });
          return;
        }
        const prev = groupStateRef.current;
        const sameGroup = prev.group?.id === group.id && !prev.group?.optedOut;
        const lastId = sameGroup && prev.chat.length ? prev.chat[prev.chat.length - 1].id : 0;
        const fresh = await api.getMessages(groupId, lastId);
        setGroupState((p) => {
          const keep = p.group?.id === group.id;
          const chat = keep ? [...p.chat, ...fresh.filter((m) => !p.chat.some((x) => x.id === m.id))] : fresh;
          return { group, chat, loading: false, error: "" };
        });
      } catch (e) {
        if (e.status === 401) return;
        setGroupState((p) => ({ ...p, loading: false, error: "Gruppendaten konnten nicht geladen werden." }));
      }
    },
    [refreshMe]
  );

  useEffect(() => {
    if (view !== "groups" || !selectedGroupId) return;
    loadGroupData(selectedGroupId);
    const interval = setInterval(() => loadGroupData(selectedGroupId), GROUP_POLL_MS);
    return () => clearInterval(interval);
  }, [view, selectedGroupId, loadGroupData]);

  function selectGroup(groupId) {
    setGroupState({ ...EMPTY_GROUP, loading: true });
    setGroupsError("");
    setSelectedGroupId(groupId);
  }

  function backToGroupList() {
    setSelectedGroupId(null);
    setGroupState(EMPTY_GROUP);
    refreshMe();
  }

  /* --- Konto --- */
  function handleAuthenticated(data) {
    applyMe(data);
    setLoadError("");
    setSsoError("");
    setView("home");
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      /* lokal trotzdem abmelden */
    }
    signOutLocally();
  }

  async function updateName(name) {
    const trimmed = (name || "").trim();
    if (trimmed === (me.displayName || "")) return;
    try {
      applyMe(await api.updateDisplayName(trimmed));
      setToast("Name gespeichert");
    } catch (e) {
      setToast(e.message);
    }
  }

  // Farbwähler feuern beim Ziehen sehr oft; gespeichert wird erst, wenn Ruhe ist.
  const colorSaveTimer = useRef(null);
  function updateColor(key, value) {
    setColors((prev) => {
      const next = { ...prev, [key]: value };
      clearTimeout(colorSaveTimer.current);
      colorSaveTimer.current = setTimeout(() => persistColors(next), 600);
      return next;
    });
  }

  async function persistColors(next) {
    // Nur Abweichungen von der Standardfarbe speichern.
    const custom = {};
    AREA_ORDER.forEach((k) => {
      if (next[k] && next[k].toLowerCase() !== AREA_META[k].defaultColor.toLowerCase()) custom[k] = next[k];
    });
    try {
      setMe(await api.saveColors(custom));
    } catch (e) {
      setToast(e.message);
    }
  }

  function resetColors() {
    clearTimeout(colorSaveTimer.current);
    const defaults = defaultColors();
    setColors(defaults);
    persistColors(defaults);
  }

  async function resetAllData() {
    if (!window.confirm("Wirklich alle gespeicherten Bewertungen und Next Steps löschen?")) return;
    try {
      for (const e of entries) await api.deleteEntry(e.weekId);
      setEntries([]);
      setToast("Daten gelöscht");
    } catch (e) {
      // Teilweise gelöscht: aktuellen Stand neu vom Server holen.
      setEntries(await api.getEntries().catch(() => entries));
      setToast(e.message);
    }
  }

  async function handleChangePassword(currentPassword, newPassword) {
    await api.changePassword(currentPassword, newPassword);
    setToast("Passwort geändert. Andere Geräte wurden abgemeldet.");
  }

  async function handleDeleteAccount(confirmation) {
    await api.deleteAccount(confirmation);
    signOutLocally();
    setToast("Dein Konto wurde gelöscht.");
  }

  async function handleUnlinkSso() {
    if (!window.confirm("Verbindung zum ICF-Konto trennen? Team-Gruppen aus Authentik verschwinden dann.")) return;
    try {
      applyMe(await api.unlinkSso());
      setToast("Verbindung getrennt.");
    } catch (e) {
      setToast(e.message);
    }
  }

  /* --- Check-in Flow --- */
  function openCheckin() {
    const currentWeekEntry = entries.find((e) => e.weekId === currentWeekId);
    setTempScores({ ...(currentWeekEntry ? currentWeekEntry.scores : latestScores) });
    setNextStepArea(currentWeekEntry ? currentWeekEntry.nextStep.area : null);
    setNextStepText(currentWeekEntry ? currentWeekEntry.nextStep.text : "");
    setShareWithGroup(currentWeekEntry ? currentWeekEntry.sharedWithGroup !== false : true);
    setCheckinError("");
    setCheckinStep(1);
    setCheckinOpen(true);
    setInfoArea(null);
  }

  async function saveCheckin() {
    setSaving(true);
    setCheckinError("");
    const weekId = getISOWeekId();
    const scores = {};
    AREA_ORDER.forEach((k) => (scores[k] = tempScores[k] ?? 5));
    try {
      const entry = await api.saveEntry(weekId, {
        scores,
        nextStep: { area: nextStepArea, text: nextStepText.trim() },
        // Ohne Gruppe wird der Eintrag als teilbar markiert, damit er nach einem
        // Beitritt sichtbar ist (wie bisher: letzter Eintrag wird beim Beitritt geteilt).
        sharedWithGroup: inAnyGroup ? shareWithGroup : true,
      });
      setEntries((prev) =>
        [...prev.filter((e) => e.weekId !== weekId), entry].sort((a, b) => a.weekId.localeCompare(b.weekId))
      );
      setCheckinOpen(false);
      setToast("Gespeichert – dein nächster Schritt ist notiert.");
    } catch (e) {
      setCheckinError(e.message);
    }
    setSaving(false);
  }

  /* --- Gruppen-Aktionen --- */
  async function runGroupAction(fn, fallbackMessage, { inDetail = true } = {}) {
    const setError = (msg) =>
      inDetail ? setGroupState((prev) => ({ ...prev, error: msg })) : setGroupsError(msg);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (e.status === 401) return;
      setError(e.message || fallbackMessage);
    }
  }

  const createGroup = (name) =>
    runGroupAction(
      async () => {
        const g = await api.createGroup((name || "").trim() || "Meine Gruppe");
        await refreshMe();
        selectGroup(g.id);
      },
      "Gruppe konnte nicht erstellt werden.",
      { inDetail: false }
    );

  const joinGroup = (code) =>
    runGroupAction(
      async () => {
        const g = await api.joinGroup(code);
        await refreshMe();
        selectGroup(g.id);
      },
      "Beitritt fehlgeschlagen.",
      { inDetail: false }
    );

  const leaveGroup = (successorId) =>
    runGroupAction(async () => {
      await api.leaveGroup(selectedGroupId, successorId);
      backToGroupList();
      setToast("Du hast die Gruppe verlassen.");
    }, "Austritt fehlgeschlagen.");

  const removeMember = (userId) =>
    runGroupAction(async () => {
      await api.removeMember(selectedGroupId, userId);
      await loadGroupData(selectedGroupId);
    }, "Mitglied konnte nicht entfernt werden.");

  const renameGroup = (rawName) =>
    runGroupAction(async () => {
      const name = (rawName || "").trim().slice(0, 40);
      if (!name) return;
      await api.renameGroup(selectedGroupId, name);
      setGroupState((prev) => (prev.group ? { ...prev, group: { ...prev.group, name } } : prev));
    }, "Name konnte nicht gespeichert werden.");

  const transferAdmin = (userId) =>
    runGroupAction(async () => {
      await api.transferAdmin(selectedGroupId, userId);
      await loadGroupData(selectedGroupId);
    }, "Leitung konnte nicht übergeben werden.");

  const setParticipation = (active) =>
    runGroupAction(async () => {
      await api.setParticipation(selectedGroupId, active);
      setGroupState((prev) => ({ ...prev, chat: [] }));
      await loadGroupData(selectedGroupId);
      await refreshMe();
      setToast(active ? "Du bist wieder dabei." : "Du nimmst an dieser Gruppe nicht mehr teil.");
    }, "Teilnahme konnte nicht geändert werden.");

  const sendChatMessage = (text) =>
    runGroupAction(async () => {
      if (!text.trim()) return;
      const msg = await api.sendMessage(selectedGroupId, text.trim());
      setGroupState((prev) => ({ ...prev, chat: [...prev.chat, msg] }));
    }, "Nachricht konnte nicht gesendet werden.");

  /* --- Darstellung --- */
  if (resetToken) {
    return (
      <>
        <ResetPasswordView
          token={resetToken}
          legal={authOptions.legal}
          onDone={() => {
            clearHash();
            setResetToken(null);
            signOutLocally();
            setToast("Dein neues Passwort ist gespeichert. Melde dich jetzt damit an.");
          }}
          onCancel={() => {
            clearHash();
            setResetToken(null);
          }}
        />
        {toast && <div className="nsr-toast">{toast}</div>}
      </>
    );
  }

  // Bis die Einträge da sind, nicht das leere Rad zeigen (sähe aus wie Datenverlust).
  if (!authChecked || (me && !entriesLoaded && !loadError)) {
    return (
      <div className="nsr-app nsr-loading">
        <p>Wird geladen …</p>
      </div>
    );
  }

  if (!me) {
    return (
      <>
        {loadError && (
          <div className="nsr-banner nsr-banner-warning">
            <span>{loadError}</span>
          </div>
        )}
        <AuthView options={authOptions} ssoError={ssoError} onAuthenticated={handleAuthenticated} />
        {toast && <div className="nsr-toast">{toast}</div>}
      </>
    );
  }

  return (
    <div className="nsr-app">
      <header className="nsr-topbar">
        <button className="nsr-icon-btn" onClick={() => setMenuOpen(true)} aria-label="Menü öffnen">
          <Menu size={22} />
        </button>
        <span className="nsr-topbar-title">Next Step</span>
        <div className="nsr-topbar-spacer" />
      </header>

      {menuOpen && (
        <div className="nsr-overlay nsr-overlay-left" onClick={() => setMenuOpen(false)}>
          <nav className="nsr-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="nsr-drawer-header">
              <span className="nsr-topbar-title">Menü</span>
              <button className="nsr-icon-btn" onClick={() => setMenuOpen(false)} aria-label="Menü schließen">
                <X size={20} />
              </button>
            </div>
            {[
              { key: "home", label: "Rad", icon: HomeIcon },
              { key: "history", label: "Historie", icon: HistoryIcon },
              { key: "groups", label: "Gruppen", icon: Users },
              { key: "settings", label: "Einstellungen", icon: SettingsIcon },
              ...(me.isAdmin ? [{ key: "admin", label: "Verwaltung", icon: ShieldCheck }] : []),
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  className={"nsr-drawer-item" + (view === item.key ? " nsr-drawer-item-active" : "")}
                  onClick={() => {
                    setView(item.key);
                    if (item.key === "groups") backToGroupList();
                    setMenuOpen(false);
                  }}
                >
                  <Icon size={19} strokeWidth={2} />
                  <span>{item.label}</span>
                  <ChevronRight size={16} className="nsr-drawer-chevron" />
                </button>
              );
            })}
            <LegalLinks legal={authOptions.legal} />
          </nav>
        </div>
      )}

      <main className="nsr-main">
        {loadError && (
          <div className="nsr-banner nsr-banner-warning">
            <span>{loadError}</span>
          </div>
        )}

        {view === "home" && (
          <div className="nsr-view nsr-home">
            <p className="nsr-verse">{VERSE}</p>

            <Wheel scores={latestScores} colors={colors} onSelectArea={setInfoArea} />

            <p className="nsr-hint nsr-center">Tipp: Tippe auf einen Bereich im Rad für Erklärungen und Leitfragen.</p>

            <button className="nsr-btn nsr-btn-primary nsr-btn-wide" onClick={openCheckin} disabled={!entriesLoaded}>
              {hasCheckedInThisWeek ? "Diese Woche erneut bewerten" : "Diese Woche bewerten"}
            </button>

            <button
              type="button"
              className="nsr-anleitung-toggle"
              onClick={() => setShowAnleitung((v) => !v)}
              aria-expanded={showAnleitung}
            >
              <span>Anleitung</span>
              <ChevronDown size={16} className={showAnleitung ? "nsr-chevron-open" : ""} />
            </button>
            {showAnleitung && (
              <div className="nsr-anleitung-body">
                <p>1. Bewertung: Du schätzt jeden Bereich für dich persönlich auf einer Skala von 0 bis 10 ein.</p>
                <p>2. Reflexion: Das Rad hilft dir zu erkennen, wo du stehst, wo es gut läuft und wo du Unterstützung brauchst.</p>
                <p>3. Next Step: Suche dir einen Bereich, in den du diese Woche besonders investieren möchtest und einen Next Step machen willst.</p>
              </div>
            )}
          </div>
        )}

        {view === "history" && <HistoryView entries={entries} colors={colors} />}

        {view === "settings" && (
          <SettingsView
            me={me}
            colors={colors}
            ssoAvailable={authOptions.sso}
            onUpdateName={updateName}
            onUpdateColor={updateColor}
            onResetColors={resetColors}
            onResetData={resetAllData}
            onChangePassword={handleChangePassword}
            onDeleteAccount={handleDeleteAccount}
            onLinkSso={() => api.startSso("link")}
            onUnlinkSso={handleUnlinkSso}
            onLogout={handleLogout}
            legal={authOptions.legal}
          />
        )}

        {view === "admin" && me.isAdmin && <AdminView />}

        {view === "groups" && (
          <GroupsView
            groups={myGroups}
            colors={colors}
            selectedGroupId={selectedGroupId}
            groupState={groupState}
            listError={groupsError}
            onSelectGroup={selectGroup}
            onBack={backToGroupList}
            onCreateGroup={createGroup}
            onJoinGroup={joinGroup}
            onLeaveGroup={leaveGroup}
            onRenameGroup={renameGroup}
            onRemoveMember={removeMember}
            onTransferAdmin={transferAdmin}
            onSetParticipation={setParticipation}
            onSendChat={sendChatMessage}
          />
        )}
      </main>

      <InfoSheet
        areaKey={infoArea}
        color={infoArea ? colors[infoArea] || AREA_META[infoArea].defaultColor : "#999"}
        onClose={() => setInfoArea(null)}
        onStartCheckin={openCheckin}
      />

      {checkinOpen && (
        <CheckinSheet
          step={checkinStep}
          tempScores={tempScores}
          setTempScores={setTempScores}
          colors={colors}
          nextStepArea={nextStepArea}
          setNextStepArea={setNextStepArea}
          nextStepText={nextStepText}
          setNextStepText={setNextStepText}
          canShare={inAnyGroup}
          shareWithGroup={shareWithGroup}
          setShareWithGroup={setShareWithGroup}
          onBack={() => setCheckinStep(1)}
          onNext={() => setCheckinStep(2)}
          onSave={saveCheckin}
          onClose={() => setCheckinOpen(false)}
          saving={saving}
          error={checkinError}
        />
      )}

      {toast && <div className="nsr-toast">{toast}</div>}
    </div>
  );
}
