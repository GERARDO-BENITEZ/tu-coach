/**
 * api-client.js — cliente compartido para todos los HTML
 * Maneja: base URL, JWT en localStorage, refresh automático, redirect al login
 */

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin

// ─── TOKEN MANAGEMENT ────────────────────────────────────────────────────────

const Auth = {
  getToken()        { return localStorage.getItem('tc_token') },
  getRefresh()      { return localStorage.getItem('tc_refresh') },
  getUser()         { try { return JSON.parse(localStorage.getItem('tc_user') || 'null') } catch { return null } },
  setSession(token, refresh, user) {
    localStorage.setItem('tc_token', token)
    localStorage.setItem('tc_refresh', refresh)
    localStorage.setItem('tc_user', JSON.stringify(user))
  },
  clear() {
    localStorage.removeItem('tc_token')
    localStorage.removeItem('tc_refresh')
    localStorage.removeItem('tc_user')
  },
  isLoggedIn() { return !!this.getToken() },
}

// ─── FETCH CON AUTH ───────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const token = Auth.getToken()

  // Modo demo — no hay backend real, lanzar error silencioso
  if (token === 'demo-token') {
    throw new Error('demo-mode')
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  }

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers })

  // Si expiró el token, intentar renovar con refresh
  if (res.status === 401 && Auth.getRefresh()) {
    const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: Auth.getRefresh() }),
    })
    if (refreshRes.ok) {
      const { token: newToken } = await refreshRes.json()
      localStorage.setItem('tc_token', newToken)
      headers.Authorization = `Bearer ${newToken}`
      res = await fetch(`${API_BASE}${path}`, { ...options, headers })
    } else {
      Auth.clear()
      window.location.href = '/login.html'
      return
    }
  }

  // Si sigue sin autenticación, ir al login
  if (res.status === 401) {
    Auth.clear()
    window.location.href = '/login.html'
    return
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Error ${res.status}`)
  }

  return res.json()
}

// Atajos
const api = {
  get:    (path)         => apiFetch(path),
  post:   (path, body)   => apiFetch(path, { method: 'POST',  body: JSON.stringify(body) }),
  put:    (path, body)   => apiFetch(path, { method: 'PUT',   body: JSON.stringify(body) }),
  delete: (path)         => apiFetch(path, { method: 'DELETE' }),
}

// ─── GUARD — redirige al login si no hay sesión ───────────────────────────────

function requireAuth(allowedRoles = []) {
  if (!Auth.isLoggedIn()) {
    window.location.href = 'login.html'
    return false
  }
  const user = Auth.getUser()
  // demo-token: permitir siempre (modo offline)
  if (Auth.getToken() === 'demo-token') return true
  if (allowedRoles.length && !allowedRoles.includes(user?.role)) {
    window.location.href = 'login.html'
    return false
  }
  return true
}

// ─── LOADING HELPER ───────────────────────────────────────────────────────────

function showLoader(selector, msg = 'Cargando...') {
  const el = document.querySelector(selector)
  if (el) el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">
    <div style="margin-bottom:6px">⏳</div>${msg}
  </div>`
}

function showError(selector, msg) {
  const el = document.querySelector(selector)
  if (el) el.innerHTML = `<div style="padding:16px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;color:var(--red);font-size:12px">⚠️ ${msg}</div>`
}

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────

function todayISO() {
  // Usa hora local para evitar desfase UTC en zonas horarias americanas
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
}

function weekRange(offset = 0) {
  const today = new Date()
  const day   = today.getDay() || 7            // 1=Lun…7=Dom
  const mon   = new Date(today)
  mon.setDate(today.getDate() - day + 1 + offset * 7)
  const sun   = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const fmt = d => `${d.getDate()} ${d.toLocaleDateString('es-MX',{month:'short'})}`
  return { start: mon.toISOString().split('T')[0], label: `${fmt(mon)} – ${fmt(sun)}` }
}

// ─── LOGOUT ──────────────────────────────────────────────────────────────────

function logout() {
  Auth.clear()
  window.location.href = 'login.html'
}

// ─── TOAST ───────────────────────────────────────────────────────────────────

function showToast(msg, type = 'success') {
  const bg = type === 'error' ? '#ef4444' : type === 'warn' ? '#f97316' : '#22c55e'
  const t = document.createElement('div')
  t.style.cssText = `position:fixed;top:16px;left:50%;transform:translateX(-50%);background:${bg};color:#fff;padding:10px 22px;border-radius:30px;font-size:13px;font-weight:700;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.35);transition:opacity .4s`
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400) }, 2400)
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TC_API — 3 flujos de datos: Coach → Workout · Atleta → Feedback · Dispositivos
//  Cada método intenta el servidor real y cae a localStorage si no está disponible.
// ═══════════════════════════════════════════════════════════════════════════════

const TC_API = {

  // ── Mapeo alias corto → UUID real ──────────────────────────────────────────
  _athleteId: { gb: 'athlete-gb-001', al: 'athlete-al-001', cr: 'athlete-al-001' },
  _resolveId(alias) { return this._athleteId[alias] || alias },

  // ── FLUJO 1: Coach guarda / actualiza un entreno ───────────────────────────

  async saveWorkout({ athleteId, date, name, type, durationMin, tssPlanned, coachNote, segments }) {
    if (Auth.getToken() === 'demo-token') return null
    try {
      return await api.post('/api/coach/workouts', {
        athleteId: this._resolveId(athleteId), date, name, type,
        durationMin, tssPlanned, coachNote, segments
      })
    } catch (e) {
      console.warn('[TC_API] saveWorkout fallback localStorage:', e.message)
      return null
    }
  },

  // Carga masiva del Plan CAC (48 días de un solo POST)
  async saveBulkPlan(athleteAlias, workouts) {
    if (Auth.getToken() === 'demo-token') return null
    try {
      return await api.post('/api/coach/workouts/bulk', {
        athleteId: this._resolveId(athleteAlias), workouts
      })
    } catch (e) {
      console.warn('[TC_API] saveBulkPlan fallback:', e.message)
      return null
    }
  },

  // Lista los entrenos de un atleta en un rango (para el coach)
  async getAthleteWorkouts(athleteAlias, start, end) {
    if (Auth.getToken() === 'demo-token') return null
    try {
      return await api.get(`/api/coach/athletes/${this._resolveId(athleteAlias)}/workouts?start=${start}&end=${end}`)
    } catch { return null }
  },

  // ── FLUJO 2: Atleta ve su plan + marca completado + da feedback ─────────────

  // Obtiene el entreno de hoy (API primero → localStorage fallback)
  async getTodayWorkout() {
    try {
      if (Auth.getToken() !== 'demo-token') {
        const w = await api.get('/api/athlete/today')
        if (w) return w
      }
    } catch { /* continúa con fallback */ }
    // Fallback: localStorage
    const plan = JSON.parse(localStorage.getItem('tc_plan_gb') || '[]')
    const today = todayISO()
    return plan.find(e => e.date === today) || null
  },

  // Obtiene el calendario completo del atleta
  async getCalendar(start, end) {
    try {
      if (Auth.getToken() !== 'demo-token')
        return await api.get(`/api/athlete/workouts?start=${start}&end=${end}`)
    } catch { /* continúa */ }
    return JSON.parse(localStorage.getItem('tc_plan_gb') || '[]')
  },

  // Marca un workout como completado + guarda feedback del atleta
  async markComplete(workoutId, { rpe, athleteNote, actualDurationMin, actualTss } = {}) {
    // Guardar siempre en localStorage (funciona sin backend)
    const plan = JSON.parse(localStorage.getItem('tc_plan_gb') || '[]')
    const today = todayISO()
    const idx = plan.findIndex(e => e.id === workoutId || e.date === today)
    if (idx >= 0) {
      plan[idx].status = 'COMPLETED'
      plan[idx].rpe = rpe
      plan[idx].athleteNote = athleteNote
      plan[idx].completedAt = new Date().toISOString()
      localStorage.setItem('tc_plan_gb', JSON.stringify(plan))
    }
    // También persiste en la BD si el servidor está activo
    if (Auth.getToken() !== 'demo-token' && workoutId) {
      try {
        return await api.put(`/api/athlete/workouts/${workoutId}/complete`, { rpe, athleteNote, actualDurationMin, actualTss })
      } catch (e) {
        console.warn('[TC_API] markComplete API fallback:', e.message)
      }
    }
    return null
  },

  // ── FLUJO 3: Sincronización de dispositivos ─────────────────────────────────

  // Envía datos Garmin y los "pega" al workout
  async syncGarmin(workoutId, data) {
    // Guardar en localStorage siempre
    const plan = JSON.parse(localStorage.getItem('tc_plan_gb') || '[]')
    const today = todayISO()
    const idx = plan.findIndex(e => e.id === workoutId || e.date === today)
    if (idx >= 0) { plan[idx].garminData = data; localStorage.setItem('tc_plan_gb', JSON.stringify(plan)) }
    // API
    if (Auth.getToken() !== 'demo-token') {
      try { return await api.post('/api/athlete/sync/garmin', { workoutId, data }) } catch { }
    }
    return { ok: true, demo: true }
  },

  // Envía datos Whoop y los "pega" al workout
  async syncWhoop(workoutId, data) {
    const plan = JSON.parse(localStorage.getItem('tc_plan_gb') || '[]')
    const today = todayISO()
    const idx = plan.findIndex(e => e.id === workoutId || e.date === today)
    if (idx >= 0) { plan[idx].whoopData = data; localStorage.setItem('tc_plan_gb', JSON.stringify(plan)) }
    if (Auth.getToken() !== 'demo-token') {
      try { return await api.post('/api/athlete/sync/whoop', { workoutId, data }) } catch { }
    }
    return { ok: true, demo: true }
  },

  // Simula un sync completo Garmin + Whoop con datos realistas para el entreno de hoy
  async simulateFullSync(workoutId, workoutDurationMin = 50) {
    const rpe = parseInt(localStorage.getItem('_lastRpe') || '7')
    // Fórmula Coggan simplificada: IF = rpe/10, TSS = IF² × duration_h × 100
    const tss  = Math.round((rpe / 10) ** 2 * workoutDurationMin * 100 / 60)
    const hrAvg = 125 + rpe * 5 + Math.round(Math.random() * 8)
    const hrMax = hrAvg + 20 + Math.round(Math.random() * 15)

    const garminData = {
      hr_avg:      hrAvg,
      hr_max:      hrMax,
      duration_min: workoutDurationMin,
      calories:    Math.round(workoutDurationMin * 8.5),
      tss_actual:  tss,
      synced_at:   new Date().toISOString(),
    }
    const whoopData = {
      strain:         +(rpe * 1.4 + Math.random() * 0.5).toFixed(1),
      recovery_score: Math.max(30, 100 - rpe * 7 - Math.round(Math.random() * 10)),
      hrv_ms:         Math.max(30, 72 - rpe * 3 + Math.round(Math.random() * 8)),
      rhr_bpm:        42 + Math.round(Math.random() * 4),
      sleep_hours:    +(7.0 + Math.random() * 1.5).toFixed(1),
      synced_at:      new Date().toISOString(),
    }

    await Promise.all([
      this.syncGarmin(workoutId, garminData),
      this.syncWhoop(workoutId, whoopData),
    ])
    return { garmin: garminData, whoop: whoopData }
  },
}
