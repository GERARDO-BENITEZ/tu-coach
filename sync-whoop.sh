#!/bin/bash
# ── Tu Coach — Sync Whoop (9:30 AM) ──────────────────────────────────────────
# Captura recuperación nocturna: HRV, sueño, FC reposo, recovery score
# Corre automáticamente a las 9:30 AM vía LaunchAgent.

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$HOME/Library/Logs/tucoach-autosync.log"
SERVER="http://localhost:3001"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [WHOOP] $1" | tee -a "$LOG"; }

log "=== Whoop Morning Sync ==="

# Verificar servidor
if ! curl -s --max-time 3 "$SERVER/health" > /dev/null 2>&1; then
  log "⚠️  Servidor no disponible — Whoop sync omitido"
  exit 0
fi

# Login
TOKEN=$(curl -s --max-time 5 -X POST "$SERVER/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"gerardo@tucoach.app","password":"TuCoach2026!"}' | \
  python3 -c "import sys,json; d=sys.stdin.read()
try: print(json.loads(d).get('token',''))
except: print('')" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  log "⚠️  Login fallido — Whoop sync omitido"
  exit 0
fi

# Sync Whoop
RESP=$(curl -s --max-time 20 "$SERVER/api/athlete/whoop/sync" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null)

RESULT=$(echo "$RESP" | python3 -c "import sys,json; d=sys.stdin.read()
try:
  obj=json.loads(d)
  if obj.get('ok'):
    w=obj.get('data',{})
    parts=[]
    if w.get('recovery_score') is not None: parts.append('Recovery %d%%' % w['recovery_score'])
    if w.get('hrv_ms') is not None: parts.append('HRV %dms' % w['hrv_ms'])
    if w.get('sleep_hours') is not None: parts.append('Sueño %.1fh' % w['sleep_hours'])
    if w.get('rhr_bpm') is not None: parts.append('FC %dbpm' % w['rhr_bpm'])
    print(' | '.join(parts) if parts else 'sin datos nuevos')
  else:
    print('fail: '+str(obj.get('error','sin token Whoop — reconecta en /integrations')))
except Exception as e: print('error: '+str(e))" 2>/dev/null)

log "✅ $RESULT"
log "=== Whoop sync completo ==="
