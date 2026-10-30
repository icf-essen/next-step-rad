#!/bin/bash
# Tägliches Backup der Next-Step-Datenbank (pg_dump, 14 Tage Aufbewahrung).
# Läuft über nextstep-db-backup.timer; bei Erfolg startet systemd danach den
# Deploy (OnSuccess=). Status als Metrik für den node-exporter (Textfile).
set -euo pipefail
DIR=/var/backups/nextstep
PROM_DIR=/var/lib/prometheus/node-exporter
PROM="$PROM_DIR/nextstep_backup.prom"

START=$(date +%s)
OK=0
SIZE=0
TMP=""

metriken() {
  local last_ok=0
  # Halbfertigen Dump nach einem Fehler nicht liegen lassen
  [ -n "$TMP" ] && rm -f "$TMP"
  # Zeitpunkt des letzten erfolgreichen Backups über Fehlschläge hinweg behalten
  if [ "$OK" -eq 1 ]; then
    last_ok=$START
  elif [ -f "$PROM" ]; then
    last_ok=$(awk '/^nextstep_backup_last_success_timestamp_seconds /{print $2}' "$PROM")
    last_ok=${last_ok:-0}
  fi
  [ -d "$PROM_DIR" ] || return 0
  cat > "$PROM.$$" <<METRIKEN
# HELP nextstep_backup_success 1 = letztes Backup erfolgreich, 0 = fehlgeschlagen
# TYPE nextstep_backup_success gauge
nextstep_backup_success $OK
# HELP nextstep_backup_last_run_timestamp_seconds Zeitpunkt des letzten Backup-Laufs
# TYPE nextstep_backup_last_run_timestamp_seconds gauge
nextstep_backup_last_run_timestamp_seconds $START
# HELP nextstep_backup_last_success_timestamp_seconds Zeitpunkt des letzten erfolgreichen Backups
# TYPE nextstep_backup_last_success_timestamp_seconds gauge
nextstep_backup_last_success_timestamp_seconds $last_ok
# HELP nextstep_backup_size_bytes Größe des letzten Backups
# TYPE nextstep_backup_size_bytes gauge
nextstep_backup_size_bytes $SIZE
METRIKEN
  chmod 644 "$PROM.$$" && mv "$PROM.$$" "$PROM"
}
trap metriken EXIT

mkdir -p "$DIR" && chmod 700 "$DIR"
F="$DIR/nextstep-$(date +%F).dump"
TMP="$F.tmp"
runuser -u postgres -- pg_dump -Fc nextstep > "$TMP"
# Ein leerer oder winziger Dump ist kein Backup
SIZE=$(stat -c %s "$TMP")
if [ "$SIZE" -lt 1024 ]; then
  echo "Backup verdächtig klein ($SIZE Bytes) – abgebrochen." >&2
  SIZE=0; exit 1
fi
mv "$TMP" "$F" && chmod 600 "$F"
TMP=""
find "$DIR" -name 'nextstep-*.dump' -mtime +14 -delete
OK=1
echo "Backup OK: $F ($SIZE Bytes)"
