#!/bin/bash
# ── Tu Coach — Alerta diaria de entreno (7:00 AM) ────────────────────────────
# Manda una notificación push a tu celular con el workout del día.
# Usa ntfy.sh — gratis, sin cuenta, app disponible en iOS y Android.
#
# Setup (una vez):
#   1. Instala la app "ntfy" en tu celular (App Store / Google Play)
#   2. Suscríbete al canal:  tucoach-gerardo-2026
#   3. Corre este script una vez para probar: bash daily-alert.sh

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$HOME/Library/Logs/tucoach-autosync.log"
SERVER="http://localhost:3001"

# Tu canal ntfy — único y privado
NTFY_TOPIC="tucoach-gerardo-2026"
NTFY_URL="https://ntfy.sh/$NTFY_TOPIC"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ALERTA] $1" | tee -a "$LOG"; }

log "=== Daily Workout Alert ==="

# ─── Login ──────────────────────────────────────────────────────────────────
if ! curl -s --max-time 3 "$SERVER/health" > /dev/null 2>&1; then
  log "⚠️  Servidor no disponible"
  # Mandar alerta de backup con solo la fecha
  curl -s -X POST "$NTFY_URL" \
    -H "Title: 🏆 Tu Coach — $(date '+%a %d %b')" \
    -H "Priority: default" \
    -H "Tags: sports_medal" \
    -d "Abre tu app para ver el entreno de hoy." > /dev/null
  exit 0
fi

TOKEN=$(curl -s --max-time 5 -X POST "$SERVER/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"gerardo@tucoach.app","password":"TuCoach2026!"}' | \
  python3 -c "import sys,json; d=sys.stdin.read()
try: print(json.loads(d).get('token',''))
except: print('')" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  log "⚠️  Login fallido"
  exit 1
fi

# ─── Obtener workout de hoy ──────────────────────────────────────────────────
TMPJSON=$(mktemp /tmp/tucoach-today-XXXX.json)
curl -s --max-time 8 "$SERVER/api/athlete/today" \
  -H "Authorization: Bearer $TOKEN" > "$TMPJSON" 2>/dev/null

# ─── Construir mensaje ───────────────────────────────────────────────────────
MESSAGE=$(python3 << PYEOF
import json

with open("$TMPJSON") as f:
    d = f.read()
obj = json.loads(d)
w = obj.get('workout')

today_fmt = __import__('datetime').date.today().strftime('%A %d de %B').capitalize()

if not w:
    print(f"📅 {today_fmt}\n\n💤 Día de descanso — recuperación activa.\nDisfruta el día libre.")
else:
    name     = w.get('name', '—')
    wtype    = w.get('type', '')
    dur      = w.get('duration_min', '—')
    tss      = w.get('tss_planned', '—')
    note     = w.get('coach_note', '')
    segs     = w.get('segments', [])
    status   = w.get('status', '')

    # Emoji por tipo
    emoji = '🚴' if 'cicl' in wtype.lower() else \
            '⛵' if any(x in wtype.lower() for x in ['vela','agua','ilca']) else \
            '💪' if any(x in wtype.lower() for x in ['fuerza','gym','strength']) else \
            '🧘' if any(x in wtype.lower() for x in ['core','movilidad']) else '🏃'

    done_mark = ' ✅' if status == 'COMPLETED' else ''

    lines = [f"{emoji} {name}{done_mark}", f"📅 {today_fmt}", ""]

    # Métricas
    lines.append(f"⏱ {dur} min  •  TSS {tss}")

    # Nota del coach (primera línea)
    if note:
        first_line = note.split('.')[0].strip()
        lines.append(f"💬 Coach: {first_line}")

    lines.append("")

    # Ejercicios (formato fuerza) o bloques (cardio)
    is_strength = any(s.get('exercise') for s in segs)
    if is_strength:
        lines.append("EJERCICIOS:")
        for s in segs:
            ex = s.get('exercise') or s.get('name', '')
            if s.get('isWarmup') or s.get('isCooldown'):
                lines.append(f"  • {ex}")
            else:
                sets = s.get('sets', '')
                reps = s.get('reps', '')
                kg   = s.get('logged_kg')
                sr   = f"{sets}×{reps}" if sets and reps else reps
                kg_txt = f" @ {kg}kg" if kg else ""
                lines.append(f"  • {ex}: {sr}{kg_txt}")
    else:
        lines.append("BLOQUES:")
        for s in segs:
            seg_name = s.get('name', '')
            zone     = s.get('zone', '')
            dur_s    = s.get('duration', '')
            reps_s   = s.get('reps', '')
            detail   = zone if zone else (reps_s if reps_s else dur_s)
            lines.append(f"  • {dur_s}  {seg_name}" + (f" — {zone}" if zone else ""))

    # Zonas FC (siempre)
    lines += ["", "ZONAS FC:", "  Z1 100–129 bpm  Z2 130–145 bpm", "  Z3 146–160 bpm  Z4 161–172 bpm"]

    print('\n'.join(lines))
PYEOF
)
rm -f "$TMPJSON"

# ─── Determinar prioridad y tags ─────────────────────────────────────────────
TMPJSON2=$(mktemp /tmp/tucoach-today2-XXXX.json)
curl -s --max-time 8 "$SERVER/api/athlete/today" \
  -H "Authorization: Bearer $TOKEN" > "$TMPJSON2" 2>/dev/null

PRIORITY=$(python3 -c "
import json
with open('$TMPJSON2') as f: obj=json.load(f)
w=obj.get('workout',{}); t=w.get('type','').lower() if w else ''
print('high' if any(x in t for x in ['fuerza','cicl']) else 'default')
" 2>/dev/null)

TAGS=$(python3 -c "
import json
with open('$TMPJSON2') as f: obj=json.load(f)
w=obj.get('workout',{})
if not w: print('zzz')
else:
  t=w.get('type','').lower()
  if 'cicl' in t: print('bike,bell')
  elif 'fuerza' in t or 'gym' in t: print('muscle,bell')
  elif 'vela' in t or 'agua' in t: print('sailboat,bell')
  elif 'core' in t or 'movilidad' in t: print('lotus_position,bell')
  else: print('sports_medal,bell')
" 2>/dev/null)

TITLE=$(python3 -c "
import json, datetime
with open('$TMPJSON2') as f: obj=json.load(f)
w=obj.get('workout',{})
dow=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']
dia=dow[datetime.date.today().weekday()]
if not w: print(f'💤 {dia} — Descanso')
else:
  n=w.get('name','Entreno')[:40]; t=w.get('type','').lower()
  e='🚴' if 'cicl' in t else '⛵' if 'vela' in t or 'agua' in t else '💪' if 'fuerza' in t else '🧘' if 'core' in t else '🏃'
  print(f'{e} {dia} — {n}')
" 2>/dev/null)
rm -f "$TMPJSON2"

# ─── Enviar notificación ─────────────────────────────────────────────────────
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$NTFY_URL" \
  -H "Title: $TITLE" \
  -H "Priority: $PRIORITY" \
  -H "Tags: $TAGS" \
  -H "Actions: view, Ver Dashboard, http://localhost:3001/athlete-dashboard.html" \
  -d "$MESSAGE")

if [ "$HTTP_STATUS" = "200" ]; then
  log "✅ Alerta enviada → ntfy.sh/$NTFY_TOPIC"
  log "   Título: $TITLE"
else
  log "❌ ntfy falló (HTTP $HTTP_STATUS)"
fi
