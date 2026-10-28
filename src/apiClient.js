// Zugriff auf die eigene API (server/). Ersetzt die direkten Firestore-Zugriffe.
// Die Sitzung steckt in einem HttpOnly-Cookie, das der Browser selbst mitschickt;
// JavaScript kommt an das Token nicht heran.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wird von der App gesetzt: reagiert auf abgelaufene Sitzungen (401).
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, path, body, { allow401 = false } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Keine Verbindung zum Server. Bitte Internetverbindung prüfen.");
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* kein JSON (z. B. Proxy-Fehlerseite) */
  }
  if (!res.ok) {
    if (res.status === 401 && !allow401 && onUnauthorized) onUnauthorized();
    const message =
      (data && data.error) ||
      (res.status >= 500 ? "Der Server hat ein Problem. Bitte später erneut versuchen." : "Anfrage fehlgeschlagen.");
    throw new ApiError(res.status, message);
  }
  return data;
}

/* ------------------------------- Konto ------------------------------- */

export const getMe = () => request("GET", "/me", undefined, { allow401: true });
export const register = (email, password, displayName) =>
  request("POST", "/auth/register", { email, password, displayName }, { allow401: true });
export const login = (email, password) => request("POST", "/auth/login", { email, password }, { allow401: true });
export const logout = () => request("POST", "/auth/logout", {}, { allow401: true });
export const updateDisplayName = (displayName) => request("PATCH", "/me", { displayName });
export const saveColors = (colors) => request("PUT", "/me/colors", { colors });
export const changePassword = (currentPassword, newPassword) =>
  request("POST", "/me/password", { currentPassword, newPassword });
export const deleteAccount = (password) => request("DELETE", "/me", { password });

/* ------------------------------ Check-ins ---------------------------- */

// Die API liefert flache Felder; die Komponenten erwarten { nextStep: { area, text } }.
function toEntry(c) {
  return {
    weekId: c.weekId,
    date: c.updatedAt,
    scores: c.scores || {},
    nextStep: { area: c.nextStepArea, text: c.nextStepText },
    sharedWithGroup: c.sharedWithGroup,
  };
}

export async function getEntries() {
  const list = await request("GET", "/checkins");
  return list.map(toEntry);
}

export async function saveEntry(weekId, { scores, nextStep, sharedWithGroup }) {
  const c = await request("PUT", "/checkins/" + encodeURIComponent(weekId), {
    scores,
    nextStepArea: nextStep.area,
    nextStepText: nextStep.text,
    sharedWithGroup,
  });
  return toEntry(c);
}

export const deleteEntry = (weekId) => request("DELETE", "/checkins/" + encodeURIComponent(weekId));

/* ------------------------------- Gruppe ------------------------------ */

export const createGroup = (name) => request("POST", "/groups", { name });
export const joinGroup = (code) => request("POST", "/groups/join", { code });
export const renameGroup = (name) => request("PATCH", "/group", { name });
export const transferAdmin = (userId) => request("POST", "/group/transfer", { userId });
export const leaveGroup = (successorId) =>
  request("POST", "/group/leave", successorId ? { successorId } : {});
export const removeMember = (userId) => request("DELETE", "/group/members/" + encodeURIComponent(userId));

/** Gruppe mit Mitgliedern, oder null, wenn man in keiner Gruppe (mehr) ist. */
export async function getGroup() {
  try {
    return await request("GET", "/group");
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export function getMessages(afterId) {
  return request("GET", "/group/messages" + (afterId ? "?after=" + afterId : ""));
}

export const sendMessage = (text) => request("POST", "/group/messages", { text });
