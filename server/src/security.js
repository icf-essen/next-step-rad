import { createHash, randomBytes, randomInt } from "node:crypto";
import { hash, verify, Algorithm } from "@node-rs/argon2";

/* ------------------------------ Passwörter ------------------------------ */

// argon2id mit den Mindestparametern der OWASP-Empfehlung (19 MiB, 2 Durchläufe).
const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password) {
  return hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(passwordHash, password) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Wird geprüft, wenn eine E-Mail unbekannt ist. So dauert ein Login mit
// unbekannter E-Mail genauso lange wie mit falschem Passwort, und die Antwortzeit
// verrät nicht, ob ein Konto existiert.
let dummyHashPromise = null;
export function dummyVerify(password) {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(randomBytes(16).toString("hex"));
  return dummyHashPromise.then((h) => verifyPassword(h, password));
}

/* ------------------------------- Sessions ------------------------------- */

// Das Cookie enthält das Token, die Datenbank nur dessen SHA-256-Hash.
// Ein DB-Leak liefert damit keine nutzbaren Sessions.
export function newSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/* ----------------------------- Gruppen-Codes ---------------------------- */

// Ohne leicht verwechselbare Zeichen (0/O, 1/I). Muss zu CHECK (code ~ '^[A-Z0-9]{6}$') passen.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateGroupCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function normalizeCode(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/* ------------------------------ Client-IP ------------------------------- */

// Kette: Cloudflare -> cloudflared -> Front-Caddy -> Backend-Caddy -> API.
// Bei Zugriffen von außen setzt Cloudflare Cf-Connecting-IP (nicht fälschbar,
// weil es keinen anderen Weg von außen gibt). Bei internen Zugriffen trägt der
// Front-Caddy die echte Client-IP in X-Forwarded-For ein.
export function clientIp(request) {
  const cf = request.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf.trim();
  const xff = request.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff) return xff.split(",")[0].trim();
  return request.ip;
}
