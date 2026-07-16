'use strict'
const { GarminConnect } = require('garmin-connect')
const { GARMIN_EMAIL, GARMIN_PASSWORD } = require('../config/env')

let _gcClient = null
let _gcReady = false

async function getGarminClient() {
  if (_gcReady) return _gcClient
  _gcClient = new GarminConnect({ username: GARMIN_EMAIL, password: GARMIN_PASSWORD })
  await _gcClient.login(GARMIN_EMAIL, GARMIN_PASSWORD)
  _gcReady = true
  return _gcClient
}

// Reconectar si la sesión expira
async function garminFetch(fn) {
  try {
    const gc = await getGarminClient()
    return await fn(gc)
  } catch (e) {
    if (e.message?.includes('401') || e.message?.includes('auth') || e.message?.includes('login')) {
      _gcReady = false
      const gc = await getGarminClient()
      return await fn(gc)
    }
    throw e
  }
}

function invalidateSession() {
  _gcReady = false
}

const GARMIN_EMOJI = { RUNNING: '🏃', CYCLING: '🚴', SWIMMING: '🏊', SAILING: '⛵', HIKING: '🥾', STRENGTH_TRAINING: '🏋️', YOGA: '🧘' }

module.exports = { getGarminClient, garminFetch, invalidateSession, GARMIN_EMOJI }
