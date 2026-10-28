// Ende-zu-Ende-Test der API gegen eine laufende Instanz.
//
//   node test/smoke.mjs                      # gegen http://127.0.0.1:3000
//   BASE=https://nextstep.icf-essen.de/next-step-rad/api node test/smoke.mjs
//   node test/smoke.mjs --rate-limit         # zusätzlich Login-Limit testen
//                                            # (sperrt die eigene IP danach 5 Minuten für Logins!)
//
// Legt drei Testkonten an und löscht sie am Ende wieder.

const BASE = process.env.BASE || "http://127.0.0.1:3000/next-step-rad/api";
const ORIGIN = process.env.ORIGIN || "https://nextstep.icf-essen.de";
const RUN_RATE_LIMIT = process.argv.includes("--rate-limit");

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.log(`  ✘ ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`);
  }
}

class Client {
  constructor(label) {
    this.label = label;
    this.cookie = null;
  }
  async req(method, path, body, headers = {}) {
    const h = { Origin: ORIGIN, ...headers };
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (this.cookie) h.Cookie = this.cookie;
    const res = await fetch(BASE + path, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      this.cookie = pair.endsWith("=") ? null : pair;
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }
}

const suffix = Math.random().toString(36).slice(2, 8);
const pw = "Test-Passwort-" + suffix;
const A = new Client("A");
const B = new Client("B");
const C = new Client("C");
const scores = { glaube: 7, beziehungen: 5, gesundheit: 6, ressourcen: 4, arbeit: 8 };

async function main() {
  console.log(`API: ${BASE}\n`);

  console.log("Grundlagen");
  check("Health", (await A.req("GET", "/health")).status === 200);
  check("Bereiche öffentlich lesbar (5)", (await A.req("GET", "/areas")).data?.length === 5);
  check("/me ohne Login -> 401", (await A.req("GET", "/me")).status === 401);

  console.log("\nKonto");
  let r = await A.req("POST", "/auth/register", { email: `a-${suffix}@test.local`, password: pw, displayName: "Anna" });
  check("Registrierung A -> 201", r.status === 201, r);
  check("Neues Konto hat keine Gruppen, Passwort, kein SSO", Array.isArray(r.data?.groups) && r.data.groups.length === 0 && r.data.hasPassword === true && r.data.ssoLinked === false);
  const aId = r.data?.id;
  r = await new Client("x").req("POST", "/auth/register", { email: `A-${suffix}@TEST.local`, password: pw });
  check("Doppelte E-Mail (andere Schreibweise) -> 409", r.status === 409, r);
  r = await new Client("x").req("POST", "/auth/register", { email: `kurz-${suffix}@test.local`, password: "zukurz" });
  check("Zu kurzes Passwort -> 400", r.status === 400, r);
  r = await new Client("x").req("POST", "/auth/login", { email: `a-${suffix}@test.local`, password: "falsch-falsch" });
  check("Login mit falschem Passwort -> 401", r.status === 401, r);
  r = await new Client("x").req("POST", "/auth/login", { email: `gibtsnicht-${suffix}@test.local`, password: "egal-egal-egal" });
  check("Login mit unbekannter E-Mail -> gleiche Meldung", r.status === 401 && r.data?.error === "E-Mail oder Passwort ist falsch.", r);
  const A2 = new Client("A2");
  r = await A2.req("POST", "/auth/login", { email: `a-${suffix}@test.local`, password: pw });
  check("Login korrekt -> 200 + Cookie", r.status === 200 && !!A2.cookie, r);
  r = await A.req("PATCH", "/me", { displayName: "Anna B." });
  check("Anzeigename ändern", r.data?.displayName === "Anna B.", r);
  r = await A.req("PUT", "/me/colors", { colors: { glaube: "#112233" } });
  check("Eigene Farbe setzen", r.data?.colors?.glaube === "#112233", r);
  r = await A.req("PUT", "/me/colors", { colors: { glaube: "rot" } });
  check("Ungültige Farbe -> 400", r.status === 400, r);
  r = await A.req("PUT", "/me/colors", { colors: { erfunden: "#112233" } });
  check("Unbekannter Bereich -> 400", r.status === 400, r);

  console.log("\nCheck-ins");
  r = await A.req("PUT", "/checkins/2026-W42", { scores, nextStepArea: "glaube", nextStepText: "Jeden Morgen 10 Minuten beten", sharedWithGroup: true });
  check("Check-in speichern", r.status === 200 && r.data?.scores?.arbeit === 8, r);
  r = await A.req("PUT", "/checkins/2026-W42", { scores: { ...scores, arbeit: 9 }, nextStepArea: "arbeit", nextStepText: "Feierabend um 18 Uhr", sharedWithGroup: true });
  check("Gleiche Woche überschreiben", r.data?.scores?.arbeit === 9 && r.data?.nextStepArea === "arbeit", r);
  r = await A.req("PUT", "/checkins/2026-W41", { scores, nextStepArea: "glaube", nextStepText: "Ältere Woche", sharedWithGroup: true });
  r = await A.req("GET", "/checkins");
  check("Verlauf: 2 Wochen, aufsteigend sortiert", r.data?.length === 2 && r.data[0].weekId === "2026-W41", r.data);
  r = await A.req("PUT", "/checkins/2026-W43", { scores: { glaube: 11 }, nextStepArea: "glaube", nextStepText: "x", sharedWithGroup: true });
  check("Score 11 -> 400", r.status === 400, r);
  r = await A.req("PUT", "/checkins/2026-W43", { scores, nextStepArea: "glaube", nextStepText: "   ", sharedWithGroup: true });
  check("Leerer nächster Schritt -> 400", r.status === 400, r);
  r = await A.req("PUT", "/checkins/2026-W99", { scores, nextStepArea: "glaube", nextStepText: "x", sharedWithGroup: true });
  check("Ungültige Woche -> 400", r.status === 400, r);
  r = await A.req("PUT", "/checkins/2026-W43", { scores, nextStepArea: "erfunden", nextStepText: "x", sharedWithGroup: true });
  check("Unbekannter Bereich im Check-in -> 400", r.status === 400, r);
  r = await A.req("PUT", "/checkins/2026-W43", { scores, nextStepArea: "glaube", nextStepText: "x", sharedWithGroup: true, userId: "fremd" });
  check("Zusatzfeld (z. B. fremde userId) -> 400", r.status === 400, r);

  console.log("\nGruppen");
  r = await A.req("POST", "/groups", { name: "Hauskreis Test" });
  check("Gruppe anlegen -> 201, A ist Leitung", r.status === 201 && r.data?.role === "admin" && /^[A-Z0-9]{6}$/.test(r.data?.code), r);
  const code = r.data?.code;
  const gid = r.data?.id;
  r = await A.req("POST", "/groups", { name: "Zweite Gruppe" });
  check("Zweite eigene Gruppe möglich (mehrere Gruppen pro Person)", r.status === 201, r);
  const gid2 = r.data?.id;
  r = await A.req("GET", "/me");
  check("/me listet beide Gruppen", r.data?.groups?.length === 2 && r.data.groups.every((g) => g.managed === false), r.data);

  r = await B.req("POST", "/auth/register", { email: `b-${suffix}@test.local`, password: pw, displayName: "Ben" });
  const bId = r.data?.id;
  await C.req("POST", "/auth/register", { email: `c-${suffix}@test.local`, password: pw, displayName: "Cara" });

  r = await B.req("POST", "/groups/join", { code: "ZZZZZZ" });
  check("Falscher Code -> 404", r.status === 404, r);
  r = await B.req("POST", "/groups/join", { code: ` ${code.slice(0, 3).toLowerCase()}-${code.slice(3)} ` });
  check("Beitritt (Code klein/mit Trennzeichen)", r.status === 200 && r.data?.role === "member", r);
  r = await B.req("POST", "/groups/join", { code });
  check("Doppelter Beitritt -> 409", r.status === 409, r);

  r = await B.req("GET", `/groups/${gid}`);
  check("B sieht 2 Mitglieder", r.data?.members?.length === 2, r);
  const annaInB = r.data?.members?.find((m) => m.userId === aId);
  check("B sieht A's letzten geteilten Check-in mit Scores", annaInB?.latestCheckin?.weekId === "2026-W42" && annaInB?.latestCheckin?.scores?.arbeit === 9, annaInB);
  check("Keine E-Mail-Adressen in der Mitgliederliste", !JSON.stringify(r.data).includes("@test.local"));
  r = await B.req("PUT", `/groups/${gid}/participation`, { active: false });
  check("Eigene Gruppe lässt sich nicht abwählen (nur verlassen) -> 400", r.status === 400, r);
  r = await C.req("PUT", `/groups/${gid}/participation`, { active: false });
  check("Außenstehende können Teilnahme nicht ändern -> 404", r.status === 404, r);
  r = await B.req("PATCH", `/groups/${gid}`, { name: "Gekapert" });
  check("Mitglied darf Gruppe nicht umbenennen -> 403", r.status === 403, r);
  r = await B.req("DELETE", `/groups/${gid}/members/${aId}`);
  check("Mitglied darf niemanden entfernen -> 403", r.status === 403, r);

  r = await C.req("GET", `/groups/${gid}`);
  check("Außenstehende C sieht die Gruppe nicht -> 404", r.status === 404, r);
  r = await C.req("GET", `/groups/${gid}/messages`);
  check("Außenstehende C liest keinen Chat -> 404", r.status === 404, r);
  r = await C.req("POST", `/groups/${gid}/messages`, { text: "Spam" });
  check("Außenstehende C schreibt nicht in den Chat -> 404", r.status === 404, r);
  r = await B.req("GET", `/groups/${gid2}`);
  check("B sieht A's zweite Gruppe nicht -> 404", r.status === 404, r);
  r = await C.req("PUT", "/checkins/2026-W42", { scores, nextStepArea: "glaube", nextStepText: "Cara privat", sharedWithGroup: true });
  r = await B.req("GET", `/groups/${gid}`);
  check("Check-ins von Nicht-Mitgliedern tauchen nicht auf", !JSON.stringify(r.data).includes("Cara privat"));

  await B.req("PUT", "/checkins/2026-W42", { scores, nextStepArea: "gesundheit", nextStepText: "Privat", sharedWithGroup: false });
  r = await A.req("GET", `/groups/${gid}`);
  check("Nicht geteilter Check-in bleibt privat", r.data?.members?.find((m) => m.userId === bId)?.latestCheckin === null, r.data);

  console.log("\nChat");
  r = await A.req("POST", `/groups/${gid}/messages`, { text: "Hallo zusammen!" });
  check("Nachricht senden -> 201", r.status === 201, r);
  const msgId = r.data?.id;
  r = await B.req("GET", `/groups/${gid}/messages`);
  check("B liest Nachricht", r.data?.length === 1 && r.data[0].text === "Hallo zusammen!" && r.data[0].isMine === false, r);
  r = await B.req("GET", `/groups/${gid}/messages?after=${msgId}`);
  check("Polling mit after liefert nur Neueres", Array.isArray(r.data) && r.data.length === 0, r);
  r = await A.req("GET", `/groups/${gid2}/messages`);
  check("Chats sind pro Gruppe getrennt", Array.isArray(r.data) && r.data.length === 0, r);
  r = await A.req("POST", `/groups/${gid}/messages`, { text: "x".repeat(2001) });
  check("Zu lange Nachricht -> 400", r.status === 400, r);

  console.log("\nLeitung und Austritt");
  r = await A.req("POST", `/groups/${gid}/transfer`, { userId: bId });
  check("Leitung an B übergeben", r.status === 204, r);
  check("A darf danach nicht mehr umbenennen", (await A.req("PATCH", `/groups/${gid}`, { name: "x" })).status === 403);
  check("B darf jetzt umbenennen", (await B.req("PATCH", `/groups/${gid}`, { name: "Neuer Name" })).data?.name === "Neuer Name");
  r = await B.req("DELETE", `/groups/${gid}/members/${aId}`);
  check("Leitung B entfernt A", r.status === 204, r);
  check("A sieht die Gruppe danach nicht mehr", (await A.req("GET", `/groups/${gid}`)).status === 404);
  check("A ist weiter in der zweiten Gruppe", (await A.req("GET", "/me")).data?.groups?.length === 1);
  await A.req("POST", "/groups/join", { code });
  r = await B.req("POST", `/groups/${gid}/leave`, { successorId: aId });
  check("Leitung B tritt aus und bestimmt A", r.status === 204, r);
  check("A ist jetzt Leitung", (await A.req("GET", "/me")).data?.groups?.find((g) => g.id === gid)?.role === "admin");
  r = await A.req("POST", `/groups/${gid2}/leave`, {});
  check("Letzte Person verlässt Gruppe -> Gruppe gelöscht", r.status === 204 && (await A.req("POST", `/groups/${gid2}/leave`, {})).status === 404);

  console.log("\nSchutzmechanismen");
  r = await A.req("POST", "/group/messages", { text: "CSRF" }, { Origin: "https://boese.example" });
  check("Fremde Origin -> 403", r.status === 403, r);
  r = await A.req("POST", "/group/messages", undefined, { "Content-Type": "text/plain" });
  check("Formular-/Text-Body statt JSON abgelehnt", r.status >= 400 && r.status < 500, r);
  r = await new Client("x").req("GET", "/groups", undefined, { Cookie: "nsr_session=gefaelscht" });
  check("Gefälschtes Session-Cookie -> 401", r.status === 401, r);

  r = await A2.req("POST", "/auth/logout", {});
  check("Logout -> 204", r.status === 204, r);
  check("Nach Logout kein Zugriff mehr", (await A2.req("GET", "/me")).status === 401);

  r = await B.req("POST", "/me/password", { currentPassword: "falsch-falsch", newPassword: pw + "-neu" });
  check("Passwort ändern mit falschem alten -> 403", r.status === 403, r);
  r = await B.req("POST", "/me/password", { currentPassword: pw, newPassword: pw + "-neu" });
  check("Passwort ändern", r.status === 204, r);

  if (RUN_RATE_LIMIT) {
    console.log("\nRate-Limit (Login)");
    let last;
    for (let i = 0; i < 12; i++) {
      last = await new Client("x").req("POST", "/auth/login", { email: `a-${suffix}@test.local`, password: "falsch-falsch" });
    }
    check("Nach 10 Fehlversuchen -> 429", last.status === 429, last);
  }
}

async function cleanup() {
  console.log("\nAufräumen");
  for (const [client, password] of [[A, pw], [B, pw + "-neu"], [C, pw]]) {
    if (!client.cookie) continue;
    let r = await client.req("DELETE", "/me", { password });
    if (r.status !== 204) r = await client.req("DELETE", "/me", { password: pw });
    check(`Testkonto ${client.label} gelöscht`, r.status === 204, r);
  }
}

try {
  await main();
} catch (err) {
  failed++;
  console.error("\nAbbruch:", err);
} finally {
  await cleanup();
  console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exit(failed ? 1 : 0);
}
