# Next Step Rad

Eine kleine Web-App für die wöchentliche Reflexion über die 5 Next-Step-Bereiche
(Glaube, Beziehungen, Gesundheit, Ressourcen, Arbeit) nach dem ICF-Modell.

Nutzerinnen und Nutzer melden sich mit E-Mail und Passwort an. Bewertungen,
Next Steps, Farben, Gruppen und der Gruppen-Chat liegen in einer eigenen
PostgreSQL-Datenbank hinter einer kleinen API (`server/`). Es werden keine
Daten an Dritte übertragen.

```
Browser ──HTTPS──► Caddy
                     ├─ /next-step-rad/        → statische Dateien (dieser Vite-Build)
                     └─ /next-step-rad/api/*   → API (server/, 127.0.0.1:3000)
                                                   └─► PostgreSQL
```

## Lokal ausprobieren

Voraussetzung: PostgreSQL mit dem Schema und eine laufende API, siehe
[`server/README.md`](server/README.md).

```bash
npm install
npm run dev
```

Öffnet die App unter `http://localhost:5173/next-step-rad/`. Der Vite-Dev-Server
leitet `/next-step-rad/api` an `http://127.0.0.1:3000` weiter. Für die API dabei
`ALLOWED_ORIGINS=http://localhost:5173` setzen.

## Bauen und ausliefern

```bash
npm ci
npm run build          # Ergebnis in dist/
```

Der Inhalt von `dist/` wird vom Webserver unter `/next-step-rad/` ausgeliefert.
Der Service Worker (PWA) cacht nur die App selbst; `/api/` ist ausdrücklich
ausgenommen.

> Hinweis: Der Workflow `.github/workflows/deploy.yml` veröffentlicht `dist/`
> weiterhin auf GitHub Pages. Dort gibt es keine API, die App kann sich dort also
> nicht anmelden. Der Workflow sollte deaktiviert oder entfernt werden, bevor
> dieser Stand auf `main` kommt.

## Projektstruktur

```
next-step-rad/
├── index.html
├── package.json
├── vite.config.js                 # PWA-/Manifest-Konfiguration, Dev-Proxy zur API
├── public/                        # Icons für Manifest & Homescreen
├── src/
│   ├── main.jsx                   # Einstiegspunkt
│   ├── App.jsx                    # die eigentliche App (Sitzung, Daten, Ansichten)
│   ├── apiClient.js               # alle Zugriffe auf die API
│   ├── constants.js               # Bereiche, Farben, Leitfragen
│   ├── styles.css
│   ├── components/                # AuthView, GroupsView, SettingsView, Wheel, …
│   └── utils/
└── server/                        # API (Fastify + PostgreSQL), siehe server/README.md
```
