# Next Step Rad – API

Backend für Next Step Rad mit PostgreSQL. Ersetzt die direkten Firestore-Zugriffe
aus dem Browser durch eine eigene API mit Benutzerkonten.

```
Browser ──HTTPS──► Caddy
                     ├─ /next-step-rad/        → statische Dateien (Vite-Build)
                     └─ /next-step-rad/api/*   → diese API (127.0.0.1:3000)
                                                   └─► PostgreSQL (127.0.0.1:5432)
```

## Endpunkte (alle unter `/next-step-rad/api`)

| Methode | Pfad | Login | Zweck |
|---|---|---|---|
| GET | `/health` | – | Zustand für Monitoring: 200 `{status: "ok"}` oder 503 `{status: "down"}` |
| GET | `/areas` | – | Die fünf Bereiche mit Standardfarben |
| GET | `/auth/options` | – | Ist SSO aktiv, Beschriftung des Knopfs |
| POST | `/auth/register` | – | Konto anlegen `{email, password, displayName?}` |
| POST | `/auth/login` | – | Anmelden `{email, password}` |
| POST | `/auth/logout` | – | Abmelden |
| GET | `/auth/oidc/start?mode=login\|link` | –/✓ | Weiterleitung zu Authentik |
| GET | `/auth/oidc/callback` | – | Rücksprung von Authentik |
| GET | `/me` | ✓ | Profil, Farben, Gruppen, `hasPassword`, `ssoLinked` |
| PATCH | `/me` | ✓ | `{displayName}` |
| PUT | `/me/colors` | ✓ | `{colors: {glaube: "#RRGGBB", …}}` (ersetzt komplett) |
| POST | `/me/password` | ✓ | `{currentPassword, newPassword}`, beendet andere Sitzungen |
| DELETE | `/me` | ✓ | Konto löschen `{password}` bzw. `{confirm: "LÖSCHEN"}` ohne Passwort |
| DELETE | `/me/sso` | ✓ | Verbindung zum ICF-Konto trennen (nur mit Passwort) |
| GET | `/checkins` | ✓ | Eigener Verlauf |
| PUT | `/checkins/:weekId` | ✓ | `{scores, nextStepArea, nextStepText, sharedWithGroup}` |
| DELETE | `/checkins/:weekId` | ✓ | Check-in einer Woche löschen |
| GET | `/groups` | ✓ | Eigene Gruppen (Team-Gruppen zuerst) |
| POST | `/groups` | ✓ | Eigene Gruppe anlegen `{name}`, man wird Leitung |
| POST | `/groups/join` | ✓ | Eigener Gruppe beitreten `{code}` |
| GET | `/groups/:id` | ✓ | Gruppe, Mitglieder, letzte geteilte Check-ins |
| PATCH | `/groups/:id` | Leitung | Umbenennen `{name}` (nicht bei Team-Gruppen) |
| POST | `/groups/:id/transfer` | Leitung | Leitung abgeben `{userId}` (nicht bei Team-Gruppen) |
| POST | `/groups/:id/leave` | ✓ | Austreten `{successorId?}` (nicht bei Team-Gruppen) |
| PUT | `/groups/:id/participation` | ✓ | Team-Gruppe ab-/anwählen `{active}` (nur Team-Gruppen) |
| DELETE | `/groups/:id/members/:userId` | Leitung | Mitglied entfernen (nicht bei Team-Gruppen) |
| GET | `/groups/:id/messages?after=ID` | ✓ | Chat (letzte 200 bzw. neuere als ID) |
| POST | `/groups/:id/messages` | ✓ | `{text}` |
| GET | `/admin/users?q=…` | Admin | Konten nach E-Mail/Name suchen (max. 25) |
| POST | `/admin/users/:id/password-reset` | Admin | Einmal-Link zum Zurücksetzen erzeugen |
| POST | `/auth/password-reset` | – | Neues Passwort mit Link-Token setzen `{token, newPassword}` |
| PATCH | `/admin/users/:id` | Admin | `{localAdmin?: bool, emailVerified?: true}` |
| POST | `/auth/verify-email` | – | Bestätigungslink einlösen `{token}`, meldet an |
| POST | `/auth/resend-verification` | – | Neuen Bestätigungslink `{email, password}` |
| POST | `/auth/forgot-password` | – | Reset-Link per Mail `{email}` (Antwort immer 202) |
| POST | `/me/totp/setup` | lokaler Admin | `{password}` → Geheimnis + otpauth-URL |
| POST | `/me/totp/confirm` | lokaler Admin | `{code}` aktiviert TOTP |
| POST | `/auth/elevate` | lokaler Admin | `{code}` schaltet Verwaltung frei (nur intern) |

## Health-Check für Monitoring und Statusseite

`GET /next-step-rad/api/health` ist ohne Anmeldung erreichbar und für Blackbox-Exporter
und Upptime gedacht.

- **200** `{"status":"ok"}`: API läuft, PostgreSQL antwortet, Schema ist aktuell.
- **503** `{"status":"down"}`: Datenbank nicht erreichbar, hängt (Antwort nach spätestens 3 s)
  oder eine Migration fehlt. Die Abfrage nennt Spalten aus der neuesten Migration, sodass
  ein vergessenes Einspielen auffällt.
- Kommt gar keine Antwort bzw. 502, läuft die API selbst nicht.
- Nach außen nur dieser Status, keine Fehlermeldung, keine Version. Der Grund steht im
  Journal (`journalctl -u next-step-rad-api`), geloggt nur beim Wechsel des Zustands.
- Ergebnis wird 5 s zwischengespeichert: Egal wie oft gefragt wird, höchstens eine
  DB-Abfrage alle 5 s. `Cache-Control: no-store`, damit Cloudflare nichts zwischenspeichert.
- Wer eine neue Migration hinzufügt, nimmt eine ihrer Spalten in `src/health.js` auf.

## E-Mail-Bestätigung und Passwort vergessen

- Registrierung legt das Konto unbestätigt an und schickt einen Link (48 h). Anmelden
  geht erst nach der Bestätigung; der Link meldet direkt an.
- Ist die Adresse schon vergeben, gibt es dieselbe Antwort wie bei einer neuen Adresse;
  die Inhaberin bekommt stattdessen eine Mail mit Link zum Neu-Festlegen des Passworts.
  So verrät die Registrierung nicht, wer ein Konto hat, und niemand kann eine fremde
  Adresse "besetzen".
- "Passwort vergessen" schickt einen Reset-Link (24 h), höchstens alle 2 Minuten pro Konto.
- Mailversand im Hintergrund über das interne Relay (`SMTP_HOST`), nodemailer ohne Datei-/URL-Zugriff.

## Break-Glass (lokale Admins)

- Ein Admin kann Passwort-Konten zu lokalen Admins machen (und wieder entziehen).
- Freischalten der Verwaltung nur: aus `ADMIN_LOCAL_NETWORKS`, mit TOTP-Code (RFC 6238),
  für die aktuelle Sitzung und höchstens `BREAKGLASS_HOURS`. Jeder Code nur einmal.
- TOTP-Geheimnis AES-256-GCM-verschlüsselt (`APP_SECRET_KEY`); Einrichtung nur mit Passwort.
- Jede Freischaltung wird geloggt (Level warn) und optional per Mail gemeldet.
- Entziehen beendet laufende Freischaltungen sofort.

## Verwaltung und Passwort zurücksetzen

- Admin ist, wer sich **per SSO** anmeldet und in Authentik in `next-step-admin` ist.
  Das Recht hängt an der Sitzung: Passwort-Anmeldungen sind nie Admin, und mit dem
  Ende der Sitzung (bzw. dem Trennen des ICF-Kontos) endet es.
- Zurücksetzen: Admin erzeugt einen Einmal-Link (24 h), gibt ihn persönlich weiter,
  die Person legt selbst ein neues Passwort fest. Der Admin kennt es nie.
  In der DB liegt nur der Hash des Tokens; ein neuer Link entwertet ältere;
  beim Einlösen werden alle Sitzungen der Person beendet.

## Anmeldung über Authentik und Team-Gruppen

- Authorization Code Flow mit PKCE, `state` und `nonce`; Tokens sieht der Browser nie.
  Der laufende Anmeldevorgang liegt im Speicher der API, im Cookie steht nur eine Zufallskennung.
- Verknüpft wird nur über die Authentik-ID (`sub`), **nie über die E-Mail**. Gibt es die
  E-Mail schon als Passwort-Konto, muss die Person sich mit Passwort anmelden und unter
  Einstellungen → Konto „ICF-Konto verbinden“ wählen.
- Authentik-Gruppen, die auf `-team` enden, werden Team-Gruppen; wer in `<team>-leitung`
  ist, leitet sie. Abgleich bei jeder SSO-Anmeldung. Team-Gruppen sind in der App
  schreibgeschützt (kein Code, kein Austreten, keine Verwaltung).
- Team-Gruppen lassen sich nicht verlassen, aber **abwählen**: Solange abgewählt, erscheint
  man dort nicht (Mitglieder, Check-ins, Zählung) und sieht weder Mitglieder noch Chat.
  Die Entscheidung bleibt über den Abgleich mit Authentik hinweg bestehen.
- Eigene Gruppen funktionieren unabhängig davon für alle wie bisher.

## Sicherheit

- Passwörter: argon2id (19 MiB, t=2). Login-Antwort verrät nicht, ob ein Konto existiert.
- Sessions: 32-Byte-Zufallstoken im Cookie (`HttpOnly`, `Secure`, `SameSite=Strict`),
  in der DB nur der SHA-256-Hash. Laufzeit 30 Tage.
- CSRF: SameSite=Strict, Origin-Prüfung für schreibende Requests, nur JSON-Bodies.
- Eingaben: JSON-Schema pro Route, unbekannte Felder werden abgelehnt;
  zusätzlich CHECK-Constraints in der DB. Nur parametrisierte SQL-Queries.
- Rate-Limits: global 300/min, Login 10/5 min, Registrierung 5/h, Gruppenbeitritt 20/10 min.
- Die DB-Rolle `nextstep_app` hat nur SELECT/INSERT/UPDATE/DELETE, kein DDL.
- systemd: Prozess darf nur mit localhost kommunizieren (`IPAddressAllow=localhost`);
  Front-Caddy und Mail-Relay werden lokal per Drop-in `netz.conf` freigegeben.

## Lokal testen

```bash
npm ci
DATABASE_URL=postgresql://nextstep_app@127.0.0.1/nextstep PGPASSWORD=… \
  COOKIE_SECURE=false ALLOWED_ORIGINS=https://nextstep.icf-essen.de npm start

# in zweitem Terminal:
npm run smoke
```

Der Smoke-Test legt drei Testkonten an (Domain `nextstep-smoke.invalid`), bestätigt
sie per `psql` (`SMOKE_PSQL`, Standard `sudo -u postgres psql -d nextstep`), prüft
alle Endpunkte inkl. Rechtegrenzen und löscht die Konten am Ende wieder.

## Datenbank-Migrationen

`migrations/` enthält das Schema in Reihenfolge. Ausführen als Eigentümer, nicht als App-Rolle:

```bash
sudo -u postgres psql -d nextstep -v ON_ERROR_STOP=1 -f migrations/005_email_bestaetigung_und_break_glass.sql
```

## Noch nicht enthalten

- Übernahme von Daten aus Firebase.
