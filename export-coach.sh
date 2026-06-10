#!/bin/bash
# ── Tu Coach — Exportar vista coach y actualizar Render ───────────────────────
# Uso: ./export-coach.sh
# Exporta tucoach.json → coach-view.json (sin tokens ni credenciales)
# Luego hace push a GitHub → Render redesplega automáticamente en ~2 min

echo "📤 Exportando datos para tu entrenadora..."

node -e "
const fs = require('fs');
if (!fs.existsSync('./data/tucoach.json')) {
  console.error('❌ No se encontró tucoach.json — inicia el servidor primero.');
  process.exit(1);
}
const db = JSON.parse(fs.readFileSync('./data/tucoach.json', 'utf8'));
const view = {
  users:          db.users || [],
  coach_athletes: db.coach_athletes || [],
  workouts:       db.workouts || [],
  pmc_cache:      db.pmc_cache || [],
  nutrition_plans: db.nutrition_plans || [],
  strength_logs:  db.strength_logs || [],
  garmin_activities: []
};
fs.writeFileSync('./data/coach-view.json', JSON.stringify(view, null, 2));
const done = view.workouts.filter(w => w.status === 'COMPLETED').length;
console.log('✅ coach-view.json listo — ' + view.workouts.length + ' sesiones, ' + done + ' completadas');
"

if [ $? -ne 0 ]; then exit 1; fi

git add data/coach-view.json
git commit -m "coach view $(date '+%Y-%m-%d %H:%M')"
git push

echo ""
echo "✅ Vista coach actualizada — Render redesplega en ~2 min"
echo "   Tu entrenadora verá los cambios pronto."
