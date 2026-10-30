// Zentrale Konfiguration. Alle Werte kommen aus Umgebungsvariablen
// (auf dem Server: /etc/next-step-rad/api.env, geladen von systemd).

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Fehlende Umgebungsvariable: ${name}`);
    process.exit(1);
  }
  return value;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    console.error(`Ungültige Zahl in ${name}: ${raw}`);
    process.exit(1);
  }
  return n;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  host: process.env.HOST || "127.0.0.1",
  port: int("PORT", 3000),

  // Pfad, unter dem Caddy die API weiterreicht. Muss zum Vite-"base" passen.
  apiPrefix: process.env.API_PREFIX || "/next-step-rad/api",
  cookiePath: process.env.COOKIE_PATH || "/next-step-rad/",

  // Nur im lokalen Test über http auf "false" setzen.
  cookieSecure: process.env.COOKIE_SECURE !== "false",
  sessionDays: int("SESSION_DAYS", 30),

  // Erlaubte Origins für schreibende Requests (kommasepariert).
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "https://nextstep.icf-essen.de")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  logLevel: process.env.LOG_LEVEL || "info",
};

// Öffentliche Adresse der App (ohne Pfad). Daraus werden Redirect-URI und
// Rücksprungadresse nach dem SSO-Login gebildet – nie aus dem Host-Header.
config.publicUrl = (process.env.PUBLIC_URL || config.allowedOrigins[0]).replace(/\/$/, "");

// Anmeldung über Authentik (OIDC). Ohne OIDC_ISSUER ist SSO abgeschaltet.
config.oidc = process.env.OIDC_ISSUER
  ? {
      issuer: process.env.OIDC_ISSUER,
      clientId: required("OIDC_CLIENT_ID"),
      clientSecret: required("OIDC_CLIENT_SECRET"),
      redirectUri: config.publicUrl + config.apiPrefix + "/auth/oidc/callback",
      scopes: process.env.OIDC_SCOPES || "openid email profile nextstep_groups",
      groupsClaim: process.env.OIDC_GROUPS_CLAIM || "nextstep_groups",
      // Authentik-Gruppen, die als Team-Gruppen übernommen werden (regulärer Ausdruck).
      teamGroupPattern: new RegExp(process.env.OIDC_TEAM_GROUP_PATTERN || "-team$"),
      // Wer in "<team><suffix>" ist, leitet das Team.
      leaderSuffix: process.env.OIDC_LEADER_SUFFIX || "-leitung",
      // Optional: nur Mitglieder dieser Authentik-Gruppe dürfen sich per SSO anmelden.
      requiredGroup: process.env.OIDC_REQUIRED_GROUP || null,
      // Kürzere Sitzungen, damit Änderungen in Authentik zeitnah greifen.
      sessionDays: int("OIDC_SESSION_DAYS", 7),
      // Wer in dieser Authentik-Gruppe ist, bekommt bei SSO-Anmeldung Zugriff auf die Verwaltung.
      adminGroup: process.env.OIDC_ADMIN_GROUP || "next-step-admin",
      buttonLabel: process.env.OIDC_BUTTON_LABEL || "Mit ICF-Konto anmelden",
    }
  : null;

// Gültigkeit der Links zum Zurücksetzen eines Passworts (Stunden).
config.passwordResetHours = int("PASSWORD_RESET_HOURS", 24);

// Links zu Impressum und Datenschutzerklärung (werden in der App angezeigt).
function httpsUrl(name) {
  const value = process.env[name];
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("kein https");
    return url.href;
  } catch {
    console.error(`Ungültige Adresse in ${name}: ${value} (erwartet: https://…)`);
    process.exit(1);
  }
}
config.legal = {
  imprintUrl: httpsUrl("LEGAL_IMPRINT_URL"),
  privacyUrl: httpsUrl("LEGAL_PRIVACY_URL"),
};

// --- E-Mail-Versand (über das interne Mail-Relay) -------------------------
// Ohne SMTP_HOST ist keine Registrierung möglich (Bestätigungsmail nötig).
config.mail = process.env.SMTP_HOST
  ? {
      host: process.env.SMTP_HOST,
      port: int("SMTP_PORT", 25),
      // Zertifikat des Relays prüfen, falls es STARTTLS anbietet. Bei einem
      // selbstsignierten Relay-Zertifikat auf "false" setzen.
      tlsVerify: process.env.SMTP_TLS_VERIFY !== "false",
      from: process.env.MAIL_FROM || "Next Step <noreply@icf-essen.de>",
    }
  : null;
config.emailVerifyHours = int("EMAIL_VERIFY_HOURS", 48);

// --- Break-Glass (lokale Admins) ------------------------------------------
// Nur aus diesen Netzen dürfen lokale Admins die Verwaltung freischalten.
// Ohne Angabe ist Break-Glass von nirgendwo freischaltbar (sicherer Standard).
config.adminLocalNetworks = (process.env.ADMIN_LOCAL_NETWORKS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// Höchstdauer einer Break-Glass-Freischaltung (Stunden).
config.breakGlassHours = int("BREAKGLASS_HOURS", 8);
// Optional: Adresse, die bei jeder Break-Glass-Freischaltung eine Mail bekommt.
config.breakGlassNotify = process.env.BREAKGLASS_NOTIFY_EMAIL || null;
// Schlüssel zur Verschlüsselung der TOTP-Geheimnisse (32 Byte, base64).
// Erzeugen mit: openssl rand -base64 32
config.secretKey = (() => {
  const raw = process.env.APP_SECRET_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    console.error("APP_SECRET_KEY muss 32 Byte (base64) lang sein: openssl rand -base64 32");
    process.exit(1);
  }
  return key;
})();
