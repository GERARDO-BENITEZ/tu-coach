#!/bin/bash
# ── Tu Coach — Exportar vista coach y actualizar Render ───────────────────────
# Uso: ./export-coach.sh
# Exporta tucoach.json → coach-view.json (con actividades Garmin, sin tokens OAuth)
# Luego hace push a GitHub → Render redesplega automáticamente en ~2 min

APP_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "📤 Exportando datos para tu entrenadora..."

node -e "
const fs = require('fs');
const path = require('path');
const appDir = $(printf '%q' "$APP_DIR" | sed "s/'/\'/g");
const dbPath = path.join(appDir, 'data', 'tucoach.json');

if (!fs.existsSync(dbPath)) {
  console.error('❌ No se encontró tucoach.json — inicia el servidor primero.');
  process.exit(1);
}
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// Incluir actividades Garmin (sin tokens OAuth ni credenciales sensibles)
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

fs.writeFileSync(path.join(appDir, 'data', 'coach-view.json'), JSON.stringify(view, null, 2));

const done    = view.workouts.filter(w => w.status === 'COMPLETED').length;
const garmin  = view.garmin_activities.length;
const pmc     = view.pmc_cache?.[0]?.data?.length || 0;
const lastPMC = view.pmc_cache?.[0]?.data?.slice(-1)?.[0];
console.log('✅ coach-view.json listo');
console.log('   ' + view.workouts.length + ' workouts (' + done + ' completados)');
console.log('   ' + garmin + ' actividades Garmin');
console.log('   PMC: ' + pmc + ' días — CTL ' + (lastPMC?.ctl?.toFixed(1)||'?') + ' / ATL ' + (lastPMC?.atl?.toFixed(1)||'?') + ' / TSB ' + (lastPMC?.tsb?.toFixed(1)||'?'));
" || exit 1

cd "$APP_DIR"

git add data/coach-view.json

# Si no hay cambios, salir silenciosamente
if git diff --staged --quiet; then
  echo "ℹ️  Sin cambios nuevos — nada que publicar."
  exit 0
fi

git commit -m "coach view $(date '+%Y-%m-%d %H:%M')" && \
git push && \
echo "" && \
echo "✅ Render redesplega en ~2 min — tu entrenadora verá los datos actualizados." || \
echo "❌ Error al hacer push. Asegúrate de que GitHub Desktop haya hecho push al menos una vez antes."
