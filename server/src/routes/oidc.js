import { randomBytes } from "node:crypto";
import * as oidc from "openid-client";
import { config } from "../config.js";
import { withTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { createSession } from "../session.js";
import { syncTeamsTx } from "../teams.js";

// Anmeldung über Authentik (OpenID Connect, Authorization Code Flow mit PKCE).
//
// Der gesamte Ablauf läuft über die API: Der Browser sieht nie ein Token von
// Authentik, sondern bekommt am Ende dieselbe Sitzung wie beim Passwort-Login.
//
//   GET /auth/oidc/start?mode=login|link  -> Weiterleitung zu Authentik
//   GET /auth/oidc/callback               -> Code gegen Tokens tauschen, Konto finden/anlegen
//
// Verknüpft wird ausschließlich über die Authentik-ID ("sub"), nie über die E-Mail.

const PROVIDER = "authentik";
const FLOW_COOKIE = "nsr_oidc";
const FLOW_MAX_AGE = 10 * 60; // Sekunden für die Anmeldung bei Authentik
const FLOW_LIMIT = 5000; // Obergrenze gleichzeitig offener Anmeldevorgänge (Speicherschutz)

let configPromise = null;

/** Discovery einmalig und erst bei Bedarf, damit die API auch ohne erreichbares Authentik startet. */
function getOidcConfig() {
  if (!configPromise) {
    configPromise = oidc
      .discovery(new URL(config.oidc.issuer), config.oidc.clientId, config.oidc.clientSecret)
      .catch((err) => {
        configPromise = null; // beim nächsten Versuch erneut probieren
        throw err;
      });
  }
  return configPromise;
}

function appUrl(params) {
  return config.publicUrl + config.cookiePath + "?" + new URLSearchParams(params).toString();
}

function flowCookieOptions(maxAge) {
  return {
    path: config.apiPrefix + "/auth/oidc",
    httpOnly: true,
    secure: config.cookieSecure,
    // Lax genügt: Der Rücksprung von Authentik ist eine Top-Level-Navigation.
    sameSite: "lax",
    maxAge,
  };
}

// Offene Anmeldevorgänge liegen nur im Speicher der API. Im Cookie steht lediglich
// eine zufällige Kennung – so lässt sich nichts manipulieren (z. B. eine fremde
// Nutzer-ID beim Verknüpfen). Ein Neustart der API bricht laufende Anmeldungen
// ab; die Person muss dann nur erneut auf den Knopf tippen.
const flows = new Map();

function saveFlow(flow) {
  const now = Date.now();
  for (const [id, f] of flows) if (f.expiresAt <= now) flows.delete(id);
  while (flows.size >= FLOW_LIMIT) flows.delete(flows.keys().next().value); // ältesten verwerfen
  const id = randomBytes(24).toString("base64url");
  flows.set(id, { ...flow, expiresAt: now + FLOW_MAX_AGE * 1000 });
  return id;
}

/** Vorgang einlösen: genau einmal verwendbar, danach gelöscht. */
function takeFlow(request) {
  const id = request.cookies[FLOW_COOKIE];
  if (typeof id !== "string" || !flows.has(id)) return null;
  const flow = flows.get(id);
  flows.delete(id);
  return flow.expiresAt > Date.now() ? flow : null;
}

class SsoError extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.ssoCode = code;
  }
}

function cleanEmail(value) {
  const email = typeof value === "string" ? value.trim() : "";
  return email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

function displayNameFrom(claims) {
  const name = [claims.name, claims.given_name, claims.preferred_username].find(
    (v) => typeof v === "string" && v.trim()
  );
  return (name || "").trim().slice(0, 60);
}

/** Konto zur Authentik-Identität finden oder neu anlegen (Modus "login"). */
async function findOrCreateUser(client, claims) {
  const existing = await client.query(
    "SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2",
    [PROVIDER, claims.sub]
  );
  if (existing.rows[0]) return existing.rows[0].user_id;

  const email = cleanEmail(claims.email);
  if (!email) throw new SsoError("no_email");

  // Gibt es die E-Mail schon als eigenes Konto, wird NICHT automatisch verknüpft:
  // Wer sein Passwort kennt, kann das ICF-Konto in den Einstellungen verbinden.
  const taken = await client.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [email]);
  if (taken.rowCount) throw new SsoError("email_taken");

  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, display_name, email_verified_at)
     VALUES ($1, NULL, $2, now()) RETURNING id`,
    [email, displayNameFrom(claims)]
  );
  await client.query("INSERT INTO user_identities (provider, subject, user_id) VALUES ($1, $2, $3)", [
    PROVIDER,
    claims.sub,
    rows[0].id,
  ]);
  return rows[0].id;
}

/** Authentik-Identität mit einem bestehenden, angemeldeten Konto verbinden (Modus "link"). */
async function linkIdentity(client, userId, claims) {
  const owner = await client.query(
    "SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2",
    [PROVIDER, claims.sub]
  );
  if (owner.rows[0]) {
    if (owner.rows[0].user_id === userId) return; // schon verbunden
    throw new SsoError("already_linked");
  }
  const mine = await client.query("SELECT 1 FROM user_identities WHERE provider = $1 AND user_id = $2", [
    PROVIDER,
    userId,
  ]);
  if (mine.rowCount) throw new SsoError("other_identity");
  await client.query("INSERT INTO user_identities (provider, subject, user_id) VALUES ($1, $2, $3)", [
    PROVIDER,
    claims.sub,
    userId,
  ]);
  // Wer ein ICF-Konto verbindet, ist über Authentik bekannt.
  await client.query("UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1", [userId]);
}

export default async function oidcRoutes(app) {
  // Für die Anmeldeseite: Gibt es SSO, und wie heißt der Knopf?
  app.get("/auth/options", async () => ({
    sso: !!config.oidc,
    ssoLabel: config.oidc ? config.oidc.buttonLabel : null,
    legal: config.legal,
  }));

  if (!config.oidc) return;

  app.get(
    "/auth/oidc/start",
    {
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { mode: { type: "string", enum: ["login", "link"] } },
        },
      },
    },
    async (request, reply) => {
      const mode = request.query.mode || "login";
      let userId = null;
      if (mode === "link") {
        try {
          await app.authenticate(request);
        } catch {
          return reply.redirect(appUrl({ sso_error: "not_logged_in" }));
        }
        userId = request.user.id;
      }

      let oidcConfig;
      try {
        oidcConfig = await getOidcConfig();
      } catch (err) {
        request.log.error({ err: err.message }, "OIDC-Discovery fehlgeschlagen");
        return reply.redirect(appUrl({ sso_error: "unavailable" }));
      }

      const verifier = oidc.randomPKCECodeVerifier();
      const flow = { state: oidc.randomState(), nonce: oidc.randomNonce(), verifier, mode, userId };
      const url = oidc.buildAuthorizationUrl(oidcConfig, {
        redirect_uri: config.oidc.redirectUri,
        scope: config.oidc.scopes,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        state: flow.state,
        nonce: flow.nonce,
      });

      reply.setCookie(FLOW_COOKIE, saveFlow(flow), flowCookieOptions(FLOW_MAX_AGE));
      return reply.redirect(url.href);
    }
  );

  app.get(
    "/auth/oidc/callback",
    { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const flow = takeFlow(request);
      reply.clearCookie(FLOW_COOKIE, { path: flowCookieOptions(0).path });

      try {
        if (request.query.error) {
          throw new SsoError(request.query.error === "access_denied" ? "cancelled" : "failed", request.query.error);
        }
        if (!flow) throw new SsoError("expired", "Kein oder ungültiges Flow-Cookie");

        const oidcConfig = await getOidcConfig();
        // Die Rücksprungadresse wird aus der konfigurierten Adresse gebaut, nicht aus Host-Headern.
        const currentUrl = new URL(config.oidc.redirectUri);
        currentUrl.search = new URL(request.url, "http://x").search;

        const tokens = await oidc.authorizationCodeGrant(oidcConfig, currentUrl, {
          pkceCodeVerifier: flow.verifier,
          expectedState: flow.state,
          expectedNonce: flow.nonce,
          idTokenExpected: true,
        });
        const idClaims = tokens.claims();
        // Userinfo liefert die Gruppen zuverlässig, auch wenn sie nicht im ID-Token stehen.
        const userinfo = await oidc.fetchUserInfo(oidcConfig, tokens.access_token, idClaims.sub);
        const claims = { ...idClaims, ...userinfo };

        const rawGroups = claims[config.oidc.groupsClaim];
        const groups = Array.isArray(rawGroups) ? rawGroups.filter((g) => typeof g === "string") : [];
        if (config.oidc.requiredGroup && !groups.includes(config.oidc.requiredGroup)) {
          throw new SsoError("not_allowed");
        }

        let userId;
        if (flow.mode === "link") {
          // Wer verknüpft, wurde beim Start über die Sitzung geprüft; die Nutzer-ID
          // stammt aus dem serverseitig gespeicherten Vorgang, nicht aus dem Browser.
          // (Das Sitzungs-Cookie ist SameSite=Strict und fehlt nach einem Formular
          // bei Authentik oft – deshalb hier keine erneute Prüfung darüber.)
          userId = flow.userId;
          await withTransaction(async (client) => {
            await linkIdentity(client, userId, claims);
            await syncTeamsTx(client, userId, groups);
          });
          return reply.redirect(appUrl({ sso: "linked" }));
        }

        userId = await withTransaction(async (client) => {
          const id = await findOrCreateUser(client, claims);
          await syncTeamsTx(client, id, groups);
          return id;
        });
        const isAdmin = !!config.oidc.adminGroup && groups.includes(config.oidc.adminGroup);
        await createSession(reply, userId, config.oidc.sessionDays, { adminVia: isAdmin ? "sso" : null });
        if (isAdmin) request.log.info({ userId }, "Admin-Sitzung über SSO angelegt");
        return reply.redirect(appUrl({ sso: "login" }));
      } catch (err) {
        const code = err instanceof SsoError ? err.ssoCode : "failed";
        if (err instanceof HttpError || !(err instanceof SsoError)) {
          request.log.warn({ err: err.message }, "SSO-Anmeldung fehlgeschlagen");
        } else {
          request.log.info({ code, detail: err.message }, "SSO-Anmeldung abgelehnt");
        }
        return reply.redirect(appUrl({ sso_error: code }));
      }
    }
  );
}
