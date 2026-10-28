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
} from "lucide-react";
import * as api from "./apiClient.js";
import { AREA_ORDER, AREA_META, VERSE } from "./constants.js";
import { getISOWeekId } from "./utils/date.js";
import { Wheel } from "./components/Wheel.jsx";
import { InfoSheet } from "./components/InfoSheet.jsx";
import { CheckinSheet } from "./components/CheckinSheet.jsx";
import { HistoryView } from "./components/HistoryView.jsx";
import { SettingsView } from "./components/SettingsView.jsx";
import { GroupsView } from "./components/GroupsView.jsx";
import { AuthView } from "./components/AuthView.jsx";

const GROUP_POLL_MS = 8000;
const EMPTY_GROUP = { group: null, chat: [], loading: false, error: "" };

function defaultColors() {
  const colors = {};
  AREA_ORDER.forEach((k) => (colors[k] = AREA_META[k].defaultColor));
  return colors;
}

export default function NextStepRad() {
  const [authChecked, setAuthChecked] = useState(false);
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
  const [groupState, setGroupState] = useState(EMPTY_GROUP);
  const [showAnleitung, setShowAnleitung] = useState(false);
  const [colors, setColors] = useState(defaultColors());

  const meRef = useRef(me);
  useEffect(() => {
    meRef.current = me;
  }, [me]);

  /* --- Sitzung prüfen und Daten laden --- */
  const applyMe = useCallback((data) => {
    setMe(data);
    setColors({ ...defaultColors(), ...(data?.colors || {}) });
  }, []);

  const signOutLocally = useCallback(() => {
    setMe(null);
    setEntries([]);
    setEntriesLoaded(false);
    setGroupState(EMPTY_GROUP);
    setView("home");
    setMenuOpen(false);
    setCheckinOpen(false);
  }, []);

  useEffect(() => {
    // Läuft eine Sitzung ab, landet man wieder auf der Anmeldeseite.
    api.setUnauthorizedHandler(() => {
      if (meRef.current) {
        signOutLocally();
        setToast("Bitte melde dich erneut an.");
      }
    });
    (async () => {
      try {
        applyMe(await api.getMe());
      } catch (e) {
        if (e.status !== 401) setLoadError(e.message);
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
  const inGroup = !!me?.group;

  /* --- Toast automatisch ausblenden --- */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  /* --- Gruppendaten laden + Polling --- */
  const loadGroupData = useCallback(async () => {
    setGroupState((prev) => ({ ...prev, loading: true }));
    try {
      const group = await api.getGroup();
      if (!group) {
        // Nicht (mehr) in einer Gruppe, z. B. von der Gruppenleitung entfernt.
        const wasInGroup = !!meRef.current?.group;
        setMe((prev) => (prev ? { ...prev, group: null } : prev));
        setGroupState(EMPTY_GROUP);
        if (wasInGroup) setToast("Du bist nicht mehr in dieser Gruppe.");
        return;
      }
      // Beim ersten Laden alle Nachrichten holen, danach nur neuere.
      setGroupState((prev) => ({ ...prev, group, loading: false, error: "" }));
      setMe((prev) =>
        prev ? { ...prev, group: { id: group.id, code: group.code, name: group.name, role: group.role } } : prev
      );
      const sameGroup = groupStateRef.current.group?.id === group.id;
      const lastId = sameGroup && groupStateRef.current.chat.length
        ? groupStateRef.current.chat[groupStateRef.current.chat.length - 1].id
        : 0;
      const fresh = await api.getMessages(lastId);
      setGroupState((prev) => ({
        ...prev,
        chat: sameGroup ? [...prev.chat, ...fresh.filter((m) => !prev.chat.some((p) => p.id === m.id))] : fresh,
      }));
    } catch (e) {
      if (e.status === 401) return;
      setGroupState((prev) => ({ ...prev, loading: false, error: "Gruppendaten konnten nicht geladen werden." }));
    }
  }, []);

  const groupStateRef = useRef(groupState);
  useEffect(() => {
    groupStateRef.current = groupState;
  }, [groupState]);

  useEffect(() => {
    if (view !== "groups" || !me?.group) return;
    loadGroupData();
    const interval = setInterval(loadGroupData, GROUP_POLL_MS);
    return () => clearInterval(interval);
  }, [view, me?.group?.id, loadGroupData]); // eslint-disable-line react-hooks/exhaustive-deps

  /* --- Konto --- */
  function handleAuthenticated(data) {
    applyMe(data);
    setLoadError("");
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
      const data = await api.saveColors(custom);
      setMe(data);
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

  async function handleDeleteAccount(password) {
    await api.deleteAccount(password);
    signOutLocally();
    setToast("Dein Konto wurde gelöscht.");
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
        sharedWithGroup: inGroup ? shareWithGroup : true,
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
  async function runGroupAction(fn, fallbackMessage) {
    setGroupState((prev) => ({ ...prev, error: "" }));
    try {
      await fn();
    } catch (e) {
      if (e.status === 401) return;
      setGroupState((prev) => ({ ...prev, error: e.message || fallbackMessage }));
    }
  }

  const createGroup = (name) =>
    runGroupAction(async () => {
      const g = await api.createGroup((name || "").trim() || "Meine Gruppe");
      setGroupState(EMPTY_GROUP);
      setMe((prev) => ({ ...prev, group: g }));
    }, "Gruppe konnte nicht erstellt werden.");

  const joinGroup = (code) =>
    runGroupAction(async () => {
      const g = await api.joinGroup(code);
      setGroupState(EMPTY_GROUP);
      setMe((prev) => ({ ...prev, group: g }));
    }, "Beitritt fehlgeschlagen.");

  const leaveGroup = (successorId) =>
    runGroupAction(async () => {
      await api.leaveGroup(successorId);
      setMe((prev) => ({ ...prev, group: null }));
      setGroupState(EMPTY_GROUP);
    }, "Austritt fehlgeschlagen.");

  const removeMember = (userId) =>
    runGroupAction(async () => {
      await api.removeMember(userId);
      await loadGroupData();
    }, "Mitglied konnte nicht entfernt werden.");

  const renameGroup = (rawName) =>
    runGroupAction(async () => {
      const name = (rawName || "").trim().slice(0, 40);
      if (!name) return;
      const g = await api.renameGroup(name);
      setMe((prev) => ({ ...prev, group: g }));
      setGroupState((prev) => (prev.group ? { ...prev, group: { ...prev.group, name } } : prev));
    }, "Name konnte nicht gespeichert werden.");

  const transferAdmin = (userId) =>
    runGroupAction(async () => {
      await api.transferAdmin(userId);
      await loadGroupData();
    }, "Leitung konnte nicht übergeben werden.");

  const sendChatMessage = (text) =>
    runGroupAction(async () => {
      if (!text.trim()) return;
      const msg = await api.sendMessage(text.trim());
      setGroupState((prev) => ({ ...prev, chat: [...prev.chat, msg] }));
    }, "Nachricht konnte nicht gesendet werden.");

  /* --- Darstellung --- */
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
        <AuthView onAuthenticated={handleAuthenticated} />
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
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  className={"nsr-drawer-item" + (view === item.key ? " nsr-drawer-item-active" : "")}
                  onClick={() => {
                    setView(item.key);
                    setMenuOpen(false);
                  }}
                >
                  <Icon size={19} strokeWidth={2} />
                  <span>{item.label}</span>
                  <ChevronRight size={16} className="nsr-drawer-chevron" />
                </button>
              );
            })}
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
            onUpdateName={updateName}
            onUpdateColor={updateColor}
            onResetColors={resetColors}
            onResetData={resetAllData}
            onChangePassword={handleChangePassword}
            onDeleteAccount={handleDeleteAccount}
            onLogout={handleLogout}
          />
        )}

        {view === "groups" && (
          <GroupsView
            me={me}
            colors={colors}
            groupState={groupState}
            onCreateGroup={createGroup}
            onJoinGroup={joinGroup}
            onLeaveGroup={leaveGroup}
            onRenameGroup={renameGroup}
            onRemoveMember={removeMember}
            onTransferAdmin={transferAdmin}
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
          canShare={inGroup}
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
