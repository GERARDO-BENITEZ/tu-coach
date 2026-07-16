'use strict'
const { v4: uuid } = require('uuid')

const now = () => new Date().toISOString()

// Fecha local YYYY-MM-DD (evita el desfase UTC de toISOString().slice(0,10) en
// zonas horarias americanas — un workout de las 11pm no se corre al día siguiente).
const localDate = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

module.exports = { uuid, now, localDate }
