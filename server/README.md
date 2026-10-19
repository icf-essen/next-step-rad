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
| POST | `/auth/register` | – | Konto anlegen `{email, password, displayName?}` |
| POST | `/auth/login` | – | Anmelden `{email, password}` |
| POST | `/auth/logout` | – | Abmelden |
| GET | `/me` | ✓ | Eigenes Profil, Farben, Gruppe |
| PATCH | `/me` | ✓ | `{displayName}` |
| PUT | `/me/colors` | ✓ | `{colors: {glaube: "#RRGGBB", …}}` (ersetzt komplett) |
| POST | `/me/password` | ✓ | `{currentPassword, newPassword}`, beendet andere Sitzungen |
| DELETE | `/me` | ✓ | Konto löschen `{password}` |
| GET | `/checkins` | ✓ | Eigener Verlauf |
| PUT | `/checkins/:weekId` | ✓ | `{scores, nextStepArea, nextStepText, sharedWithGroup}` |
| DELETE | `/checkins/:weekId` | ✓ | Check-in einer Woche löschen |
| POST | `/groups` | ✓ | Gruppe anlegen `{name}`, man wird Admin |
| POST | `/groups/join` | ✓ | Beitreten `{code}` |
| GET | `/group` | ✓ | Eigene Gruppe, Mitglieder, letzte geteilte Check-ins |
| PATCH | `/group` | Admin | Umbenennen `{name}` |
| POST | `/group/transfer` | Admin | Leitung abgeben `{userId}` |
| POST | `/group/leave` | ✓ | Austreten `{successorId?}` |
| DELETE | `/group/members/:userId` | Admin | Mitglied entfernen |
| GET | `/group/messages?after=ID` | ✓ | Chat (letzte 200 bzw. neuere als ID) |
| POST | `/group/messages` | ✓ | `{text}` |

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

## Noch nicht enthalten

- Passwort-Reset per E-Mail (benötigt Freigabe DMZ → Mail-Relay). Bis dahin
  setzt die IT-Administration ein Passwort bei Bedarf manuell zurück.
- Übernahme von Daten aus Firebase.
