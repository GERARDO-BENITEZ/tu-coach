'use strict'
const jwt = require('jsonwebtoken')
const { JWT_SECRET } = require('../config/env')

function auth(req, res, next) {
  const hdr = req.headers.authorization
  if (!hdr?.startsWith('Bearer ')) return res.status(401).json({ error: 'Sin token' })
  try {
    req.user = jwt.verify(hdr.slice(7), JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

// Para flujos OAuth iniciados desde el browser (sin header Authorization) —
// acepta el token también desde ?token= en la query string.
function authBrowser(req, res, next) {
  const raw = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : req.query.token
  if (!raw) return res.status(401).json({ error: 'Sin token' })
  try {
    req.user = jwt.verify(raw, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

module.exports = { auth, authBrowser }
