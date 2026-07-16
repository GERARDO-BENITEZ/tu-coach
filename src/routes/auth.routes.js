'use strict'
const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { JWT_SECRET } = require('../config/env')
const { DB, refreshFromDisk } = require('../services/db')

const router = express.Router()

const makeToken = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role, name: u.name }, JWT_SECRET, { expiresIn: '7d' })

router.post('/login', (req, res) => {
  refreshFromDisk() // refrescar por si otro proceso modificó el archivo
  const { email, password } = req.body || {}
  const u = DB.users.find((u) => u.email === email)
  if (!u || !bcrypt.compareSync(password, u.password_hash))
    return res.status(401).json({ error: 'Credenciales incorrectas' })
  const token = makeToken(u)
  res.json({ token, refreshToken: token, user: { id: u.id, email: u.email, name: u.name, role: u.role } })
})

router.post('/refresh', (req, res) => {
  try {
    const d = jwt.verify(req.body?.refreshToken, JWT_SECRET)
    res.json({ token: makeToken(d) })
  } catch {
    res.status(401).json({ error: 'Refresh token inválido' })
  }
})

module.exports = router
