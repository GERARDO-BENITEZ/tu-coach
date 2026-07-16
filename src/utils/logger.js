'use strict'
// ═══════════════════════════════════════════════════════════════════════════════
//  Logger mínimo, sin dependencias — mismo criterio que en tucoach-plataforma.
//  Este server corre 24/7 vía LaunchAgent y escribe a un archivo de log fijo
//  (~/Library/Logs/tucoach-server.log redirigido por el plist), así que el
//  formato legible (no JSON) es el correcto: Gerardo lo lee con `tail` a mano,
//  no hay agregador de logs consumiéndolo.
// ═══════════════════════════════════════════════════════════════════════════════
function base(level, msg, meta) {
  const tag = { info: '  ', warn: '⚠️ ', error: '❌', debug: '🔧' }[level] || '  '
  if (meta !== undefined) console.log(`${tag} [${level.toUpperCase()}] ${msg}`, meta)
  else console.log(`${tag} [${level.toUpperCase()}] ${msg}`)
}

module.exports = {
  info: (msg, meta) => base('info', msg, meta),
  warn: (msg, meta) => base('warn', msg, meta),
  debug: (msg, meta) => base('debug', msg, meta),
  error: (msg, err) => base('error', msg, err instanceof Error ? { message: err.message, stack: err.stack } : err),
}
