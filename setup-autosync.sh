#!/bin/bash
# ── Tu Coach — Instalar syncs automáticos ────────────────────────────────────
# Instala dos LaunchAgents:
#   · Whoop   → 9:30 AM   (recuperación nocturna: HRV, sueño, FC)
#   · Garmin  → 11:50 PM  (actividades del día + PMC + export → Render)

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_DIR="$HOME/Library/LaunchAgents"
TOKEN_FILE="$APP_DIR/.github-token"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Tu Coach — Instalador de Syncs Automáticos"
echo "  · Whoop  →  9:30 AM  (recuperación)"
echo "  · Garmin → 11:50 PM  (entreno + export)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── Paso 1: GitHub Personal Access Token ───────────────────────────────────

if [ ! -f "$TOKEN_FILE" ]; then
  echo "📋 PASO 1 — Token de GitHub (para el push nocturno a Render)"
  echo ""
  echo "   1. Abre: https://github.com/settings/tokens/new"
  echo "   2. Note: Tu Coach Auto-Sync"
  echo "   3. Expiration: No expiration"
  echo "   4. Marca: ✅ repo"
  echo "   5. Clic en 'Generate token' y copia el resultado (ghp_...)"
  echo ""
  read -r -p "   Pega tu token aquí: " GITHUB_TOKEN
  echo ""

  if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Token vacío — cancela e intenta de nuevo."
    exit 1
  fi

  echo "$GITHUB_TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "✅ Token guardado"
else
  GITHUB_TOKEN=$(cat "$TOKEN_FILE")
  echo "✅ Token ya configurado"
fi

# Configurar remote con token
cd "$APP_DIR"
git remote set-url origin "https://x-token:${GITHUB_TOKEN}@github.com/gerardobeparis2020-art/tu-coach.git"

echo "🧪 Probando conexión con GitHub..."
if git ls-remote origin > /dev/null 2>&1; then
  echo "✅ Conexión OK"
else
  echo "❌ No se pudo conectar. Revisa que el token tenga permisos 'repo'."
  rm -f "$TOKEN_FILE"
  exit 1
fi

# ─── Paso 2: Permisos de scripts ────────────────────────────────────────────

chmod +x "$APP_DIR/auto-export.sh"
chmod +x "$APP_DIR/sync-whoop.sh"
chmod +x "$APP_DIR/export-coach.sh"
mkdir -p "$PLIST_DIR"

# ─── Paso 3: LaunchAgent — Whoop 9:30 AM ────────────────────────────────────

echo ""
echo "📋 Instalando Whoop sync → 9:30 AM..."

PLIST_WHOOP="$PLIST_DIR/com.tucoach.whoop.plist"
cat > "$PLIST_WHOOP" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.tucoach.whoop</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${APP_DIR}/sync-whoop.sh</string>
  </array>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>30</integer>
  </dict>

  <key>RunAtLoad</key>
  <false/>

  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/tucoach-autosync.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/tucoach-autosync-error.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
</dict>
</plist>
PLIST

launchctl unload "$PLIST_WHOOP" 2>/dev/null
launchctl load  "$PLIST_WHOOP" 2>/dev/null && echo "✅ Whoop sync instalado (9:30 AM)" || echo "⚠️  Whoop plist creado"

# ─── Paso 4: LaunchAgent — Garmin + Export 11:50 PM ─────────────────────────

echo "📋 Instalando Garmin sync + export → 11:50 PM..."

PLIST_GARMIN="$PLIST_DIR/com.tucoach.autosync.plist"
cat > "$PLIST_GARMIN" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.tucoach.autosync</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${APP_DIR}/auto-export.sh</string>
  </array>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>23</integer>
    <key>Minute</key>
    <integer>50</integer>
  </dict>

  <key>RunAtLoad</key>
  <false/>

  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/tucoach-autosync.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/tucoach-autosync-error.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
</dict>
</plist>
PLIST

launchctl unload "$PLIST_GARMIN" 2>/dev/null
launchctl load  "$PLIST_GARMIN" 2>/dev/null && echo "✅ Garmin sync instalado (11:50 PM)" || echo "⚠️  Garmin plist creado"

# ─── Paso 5: Primer export ahora ────────────────────────────────────────────

echo ""
echo "📋 Corriendo primer export ahora..."
echo ""
bash "$APP_DIR/auto-export.sh"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Syncs automáticos instalados"
echo ""
echo "  🩺 Whoop   →  9:30 AM  — HRV · Sueño · Recovery"
echo "  🚴 Garmin  → 11:50 PM  — Actividades · PMC · Render"
echo ""
echo "  Ver logs en tiempo real:"
echo "  tail -f ~/Library/Logs/tucoach-autosync.log"
echo ""
echo "  Correr manualmente:"
echo "  bash '$APP_DIR/sync-whoop.sh'    # Whoop ahora"
echo "  bash '$APP_DIR/auto-export.sh'   # Garmin + export ahora"
echo ""
echo "  Desinstalar:"
echo "  launchctl unload $PLIST_DIR/com.tucoach.whoop.plist"
echo "  launchctl unload $PLIST_DIR/com.tucoach.autosync.plist"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
