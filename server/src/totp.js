import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { BlockList, isIPv4 } from "node:net";
import { config } from "./config.js";

// TOTP nach RFC 6238 (SHA-1, 6 Ziffern, 30 Sekunden) – kompatibel mit allen
// gängigen Authenticator-Apps und Vaultwarden.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str.replace(/=+$/, "").toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Ungültiges Base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function codeForStep(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(msg).digest();
  const offset = h[h.length - 1] & 15;
  const num = ((h[offset] & 127) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(num % 1_000_000).padStart(6, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Prüft einen Code mit ±1 Zeitfenster Toleranz. Gibt das passende Fenster zurück
 * (für den Schutz gegen Wiederverwendung) oder null.
 */
export function verifyTotp(secretBase32, code, lastUsedStep = null, now = Date.now()) {
  if (!/^\d{6}$/.test(code || "")) return null;
  const secret = base32Decode(secretBase32);
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (lastUsedStep !== null && s <= lastUsedStep) continue; // schon benutzt
    const expected = Buffer.from(codeForStep(secret, s));
    if (timingSafeEqual(expected, Buffer.from(code))) return s;
  }
  return null;
}

export function newTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function otpauthUrl(secret, account) {
  const label = encodeURIComponent(`Next Step:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Next Step")}&algorithm=SHA1&digits=6&period=30`;
}

/* ------------------- Verschlüsselung des Geheimnisses ------------------- */
// Das Geheimnis liegt verschlüsselt in der Datenbank (AES-256-GCM). Ein DB-Dump
// allein reicht damit nicht, um Codes zu erzeugen.

export function encryptSecret(plain) {
  if (!config.secretKey) throw new Error("APP_SECRET_KEY fehlt");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", config.secretKey, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(stored) {
  if (!config.secretKey) throw new Error("APP_SECRET_KEY fehlt");
  const [v, iv, tag, enc] = stored.split(":");
  if (v !== "v1") throw new Error("Unbekanntes Format");
  const d = createDecipheriv("aes-256-gcm", config.secretKey, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}

/* ------------------------- Internes Netz? ------------------------------- */

const internal = new BlockList();
for (const net of config.adminLocalNetworks) {
  const [addr, bits] = net.split("/");
  if (isIPv4(addr)) internal.addSubnet(addr, Number(bits ?? 32), "ipv4");
}

export function isInternalIp(ip) {
  const v4 = (ip || "").replace(/^::ffff:/, "");
  return isIPv4(v4) && internal.check(v4, "ipv4");
}
