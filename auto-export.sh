#!/bin/bash
# ── Tu Coach — Sync Garmin + Export + Push (11:50 PM) ────────────────────────
# Pipeline completo de fin de día:
#   Garmin sync → PMC rebuild → export coach-view.json → git push → Render
#
# Instalar: ./setup-autosync.sh
# Ver logs:  tail -f ~/Library/Logs/tucoach-autosync.log

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$HOME/Library/Logs/tucoach-autosync.log"
SERVER="http://localhost:3001"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [GARMIN] $1" | tee -a "$LOG"; }
log_section() { log ""; log "─── $1 ───"; }

log_section "Tu Coach Night Sync — $(date '+%Y-%m-%d')"

# ─── 1. Verificar servidor ──────────────────────────────────────────────────

SERVER_RUNNING=false
if curl -s --max-time 3 "$SERVER/health" > /dev/null 2>&1; then
  SERVER_RUNNING=true
  log "✅ Servidor local activo"
else
  log "⚠️  Servidor no disponible — exportando última versión guardada"
fi

# ─── 2. Garmin sync + PMC rebuild ──────────────────────────────────────────

if $SERVER_RUNNING; then
  TOKEN=$(curl -s --max-time 5 -X POST "$SERVER/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"gerardo@tucoach.app","password":"TuCoach2026!"}' | \
    python3 -c "import sys,json; d=sys.stdin.read()
try: print(json.loads(d).get('token',''))
except: print('')" 2>/dev/null)

  if [ -n "$TOKEN" ]; then
    log "✅ Login OK"

    # Sync Garmin — actividades del día
    log_section "Garmin Sync"
    GARMIN_RESP=$(curl -s --max-time 20 "$SERVER/api/athlete/garmin/sync" \
      -H "Authorization: Bearer $TOKEN" 2>/dev/null)
    GARMIN_OUT=$(echo "$GARMIN_RESP" | python3 -c "import sys,json; d=sys.stdin.read()
try:
  obj=json.loads(d)
  if obj.get('ok'):
    act=obj.get('activity',{})
    if act:
      print('%s — %dmin · TSS %s' % (act.get('activity_name','?'), act.get('duration_min',0), act.get('tss_actual','?')))
    else:
      print('sin actividad nueva hoy')
  else:
    print('fail: '+str(obj.get('error','?')))
except Exception as e: print('parse error: '+str(e))" 2>/dev/null)
    log "Garmin: $GARMIN_OUT"

    # Rebuild PMC con TSS del día
    log_section "PMC Rebuild"
    PMC_RESP=$(curl -s --max-time 20 "$SERVER/api/athlete/pmc/rebuild" \
      -H "Authorization: Bearer $TOKEN" 2>/dev/null)
    PMC_OUT=$(echo "$PMC_RESP" | python3 -c "import sys,json; d=sys.stdin.read()
try:
  obj=json.loads(d)
  if obj.get('ok'):
    last=obj.get('data',{}).get('last',{})
    print('CTL %.1f / ATL %.1f / TSB %.1f' % (last.get('ctl',0),last.get('atl',0),last.get('tsb',0)))
  else:
    print('fail: '+str(obj.get('error','?')))
except Exception as e: print('parse error: '+str(e))" 2>/dev/null)
    log "PMC: $PMC_OUT"
  else
    log "⚠️  Login fallido — exportando datos actuales sin sync"
  fi
fi

# ─── 3. Export coach-view.json ──────────────────────────────────────────────

log_section "Export"
cd "$APP_DIR"

EXPORT_OUT=$(node -e "
const fs   = require('fs');
const path = require('path');
const db   = JSON.parse(fs.readFileSync(path.join('$APP_DIR','data','tucoach.json'),'utf8'));

const view = {
  users:             db.users || [],
  coach_athletes:    db.coach_athletes || [],
  workouts:          db.workouts || [],
  pmc_cache:         db.pmc_cache || [],
  nutrition_plans:   db.nutrition_plans || [],
  strength_logs:     db.strength_logs || [],
  garmin_activities: db.garmin_activities || [],
  device_syncs:      db.device_syncs || [],
  wellness:          db.wellness || [],
  whoop_history:     db.whoop_history || [],
  body_composition:  db.body_composition || []
};

fs.writeFileSync(path.join('$APP_DIR','data','coach-view.json'), JSON.stringify(view, null, 2));

const done    = view.workouts.filter(w => w.status === 'COMPLETED').length;
const lastPMC = view.pmc_cache?.[0]?.data?.slice(-1)?.[0] || {};
console.log(view.workouts.length + ' workouts (' + done + ' done) | ' + view.garmin_activities.length + ' Garmin | CTL ' + (lastPMC.ctl||0).toFixed(1) + ' / TSB ' + (lastPMC.tsb||0).toFixed(1));
" 2>&1)

if [ $? -eq 0 ]; then
  log "✅ $EXPORT_OUT"
  # Recargar DB en servidor local sin reiniciar
  if $SERVER_RUNNING && [ -n "$TOKEN" ]; then
    curl -s -X POST "$SERVER/api/reload-db" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1 && log "🔄 DB recargada en servidor"
  fi
else
  log "❌ Export falló: $EXPORT_OUT"
  exit 1
fi

# ─── 4. Git push → Render ──────────────────────────────────────────────────

log_section "Git Push"

TOKEN_FILE="$APP_DIR/.github-token"
if [ -f "$TOKEN_FILE" ]; then
  GH_TOKEN=$(cat "$TOKEN_FILE")
  git remote set-url origin "https://x-token:${GH_TOKEN}@github.com/gerardobeparis2020-art/tu-coach.git" 2>/dev/null
fi

git add data/coach-view.json

if git diff --staged --quiet; then
  log "ℹ️  Sin cambios — Render ya está actualizado"
  exit 0
fi

git commit -m "night-sync $(date '+%Y-%m-%d %H:%M')" 2>/dev/null
if git push 2>&1 | tee -a "$LOG"; then
  log "✅ Push OK — Render actualiza en ~2 min"
else
  log "❌ Push falló — ejecuta setup-autosync.sh para reconfigurar el token"
  exit 1
fi

log ""
log "=== Night sync completo ==="
