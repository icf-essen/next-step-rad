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
| GET | `/health` | – | DB erreichbar? |
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
| DELETE | `/groups/:id/members/:userId` | Leitung | Mitglied entfernen (nicht bei Team-Gruppen) |
| GET | `/groups/:id/messages?after=ID` | ✓ | Chat (letzte 200 bzw. neuere als ID) |
| POST | `/groups/:id/messages` | ✓ | `{text}` |

## Anmeldung über Authentik und Team-Gruppen

- Authorization Code Flow mit PKCE, `state` und `nonce`; Tokens sieht der Browser nie.
  Der laufende Anmeldevorgang liegt im Speicher der API, im Cookie steht nur eine Zufallskennung.
- Verknüpft wird nur über die Authentik-ID (`sub`), **nie über die E-Mail**. Gibt es die
  E-Mail schon als Passwort-Konto, muss die Person sich mit Passwort anmelden und unter
  Einstellungen → Konto „ICF-Konto verbinden“ wählen.
- Authentik-Gruppen, die auf `-team` enden, werden Team-Gruppen; wer in `<team>-leitung`
  ist, leitet sie. Abgleich bei jeder SSO-Anmeldung. Team-Gruppen sind in der App
  schreibgeschützt (kein Code, kein Austreten, keine Verwaltung).
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
- systemd: Prozess darf nur mit localhost kommunizieren (`IPAddressAllow=localhost`).

## Lokal testen

```bash
npm ci
DATABASE_URL=postgresql://nextstep_app@127.0.0.1/nextstep PGPASSWORD=… \
  COOKIE_SECURE=false ALLOWED_ORIGINS=https://nextstep.icf-essen.de npm start

# in zweitem Terminal:
npm run smoke
```

Der Smoke-Test legt drei Testkonten an, prüft alle Endpunkte inkl. Rechtegrenzen
und löscht die Konten am Ende wieder.

## Datenbank-Migrationen

`migrations/` enthält das Schema in Reihenfolge. Ausführen als Eigentümer, nicht als App-Rolle:

```bash
sudo -u postgres psql -d nextstep -v ON_ERROR_STOP=1 -f migrations/002_sso_und_mehrere_gruppen.sql
```

## Noch nicht enthalten

- Passwort-Reset per E-Mail (benötigt Freigabe DMZ → Mail-Relay). Bis dahin
  setzt die IT-Administration ein Passwort bei Bedarf manuell zurück.
- Übernahme von Daten aus Firebase.
