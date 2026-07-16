'use strict'
const logger = require('../utils/logger')

function notFound(req, res) {
  res.status(404).json({ error: 'Ruta no encontrada' })
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error(`${req.method} ${req.originalUrl} → ${err.message}`, err)
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' })
}

module.exports = { notFound, errorHandler }
