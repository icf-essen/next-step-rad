#!/bin/bash
# Next Step Rad: main aus icf-essen/next-step-rad holen, bauen und ausrollen.
# Läuft nachts automatisch nach erfolgreichem DB-Backup (OnSuccess=), kann aber
# auch von Hand als root gestartet werden. Bei neuen Migrationen: erst
# einspielen, dann mit --migrationen-eingespielt erneut starten.
#
# Exit-Codes / Metrik nextstep_deploy_status: 0 = ok, 1 = Fehler,
# 2 = wartet auf Migration
set -euo pipefail
REPO=/opt/next-step-rad/repo
WEB=/srv/www/next-step-rad
UNIT=/etc/systemd/system/next-step-rad-api.service
HEALTH=http://127.0.0.1:3000/next-step-rad/api/health
PROM_DIR=/var/lib/prometheus/node-exporter
PROM="$PROM_DIR/nextstep_deploy.prom"
# Zuletzt erfolgreich ausgerollter Commit. Maßgeblich ist diese Datei, nicht
# HEAD: Scheitert ein Build nach dem Merge, wird beim nächsten Lauf erneut
# ausgerollt statt fälschlich "bereits aktuell" zu melden.
STATE=/var/lib/next-step-rad/deployed-commit

[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen."; exit 1; }
# -H: HOME des Dienstbenutzers setzen (npm-Cache), auch wenn per systemd gestartet
as() { sudo -H -u nextstep "$@"; }

# Nie zweimal gleichzeitig (Timer und Handaufruf)
exec 9>/run/next-step-rad-deploy.lock
flock -n 9 || { echo "Deploy läuft bereits."; exit 1; }

START=$(date +%s)
STATUS=1          # bis zum Beweis des Gegenteils: Fehler
DEPLOYED=0        # 1, wenn in diesem Lauf tatsächlich ausgerollt wurde

metriken() {
  [ -d "$PROM_DIR" ] || return 0
  local commit last_change=0
  # Der tatsächlich laufende Stand, nicht HEAD (nach gescheitertem Build abweichend)
  commit=$(cut -c1-7 "$STATE" 2>/dev/null || true)
  commit=${commit:-unbekannt}
  if [ "$DEPLOYED" -eq 1 ]; then
    last_change=$START
  elif [ -f "$PROM" ]; then
    last_change=$(awk '/^nextstep_deploy_last_change_timestamp_seconds /{print $2}' "$PROM")
    last_change=${last_change:-0}
  fi
  cat > "$PROM.$$" <<METRIKEN
# HELP nextstep_deploy_status 0 = ok, 1 = Fehler, 2 = wartet auf Migration
# TYPE nextstep_deploy_status gauge
nextstep_deploy_status $STATUS
# HELP nextstep_deploy_last_run_timestamp_seconds Zeitpunkt des letzten Deploy-Laufs
# TYPE nextstep_deploy_last_run_timestamp_seconds gauge
nextstep_deploy_last_run_timestamp_seconds $START
# HELP nextstep_deploy_last_change_timestamp_seconds Zeitpunkt der letzten tatsächlichen Auslieferung
# TYPE nextstep_deploy_last_change_timestamp_seconds gauge
nextstep_deploy_last_change_timestamp_seconds $last_change
# HELP nextstep_deploy_info Laufender Commit
# TYPE nextstep_deploy_info gauge
nextstep_deploy_info{commit="$commit"} 1
METRIKEN
  chmod 644 "$PROM.$$" && mv "$PROM.$$" "$PROM"
}
trap metriken EXIT

cd "$REPO"
as git fetch -q origin main
NEW=$(as git rev-parse origin/main)
# Erster Lauf: laufenden Stand (HEAD vor dem Merge) als Ausgangspunkt festhalten
if [ ! -s "$STATE" ]; then
  mkdir -p "$(dirname "$STATE")" && as git rev-parse HEAD > "$STATE"
fi
OLD=$(cat "$STATE")
if [ "$OLD" = "$NEW" ]; then
  STATUS=0
  echo "Bereits aktuell: ${NEW:0:7}"; exit 0
fi

MIG=$(as git diff --name-only "$OLD" "$NEW" -- server/migrations)
if [ -n "$MIG" ] && [ "${1:-}" != "--migrationen-eingespielt" ]; then
  STATUS=2
  echo "Neue Migrationen – erst einspielen, dann mit --migrationen-eingespielt erneut starten:"
  echo "$MIG"; exit 2
fi

as git merge --ff-only -q origin/main
as npm ci --no-audit --no-fund
as npm run build
(cd server && as npm ci --omit=dev --no-audit --no-fund)

rsync -a --delete dist/ "$WEB/"
if ! cmp -s server/deploy/next-step-rad-api.service "$UNIT"; then
  cp server/deploy/next-step-rad-api.service "$UNIT"
  systemctl daemon-reload
  echo "systemd-Unit aktualisiert."
fi
DEPLOYED=1
systemctl restart next-step-rad-api

for _ in $(seq 1 10); do
  if curl -fsS "$HEALTH" >/dev/null 2>&1; then
    STATUS=0
    echo "$NEW" > "$STATE"
    echo "Deploy OK: $(as git rev-parse --short HEAD)"; exit 0
  fi
  sleep 1
done
echo "API antwortet nicht – journalctl -u next-step-rad-api -n 50"; exit 1
