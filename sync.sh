#!/bin/bash
# ── Tu Coach — Sincronizar cambios con GitHub ──────────────────────────────────
# Uso: ./sync.sh "descripción del cambio"
# Sin argumento: usa timestamp automático

MSG="${1:-"update $(date '+%Y-%m-%d %H:%M')"}"

echo "🔄 Sincronizando Tu Coach con GitHub..."
echo "   Mensaje: $MSG"
echo ""

git add -A
git status --short
echo ""

git commit -m "$MSG" && git push && echo "✅ Subido a GitHub correctamente." || echo "❌ Error al subir. Verifica la conexión y el remote."
