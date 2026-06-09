# Tu Coach — Plataforma de Coaching Deportivo ILCA 7

> Sistema de coaching integral para regatistas de alto rendimiento. Integra Garmin, Whoop, PMC (CTL/ATL/TSB), nutrición y análisis por IA local.

---

## ¿Qué es?

Tu Coach es un servidor local que actúa como el cerebro de un atleta de élite:

- **Performance Management Chart** (CTL/ATL/TSB) — mismo modelo que TrainingPeaks
- **5 Agentes de IA locales** — análisis fase-aware en tiempo real, sin API externa
- **Integración Garmin Connect** — sync automático de actividades y TSS real
- **Integración Whoop** — recovery score, HRV y sueño vinculados al plan
- **Plan CAC Games 2026** — F1 Base → F2 Carga → F3 Especificidad → F4 Taper (63 sesiones)
- **Programas de fuerza élite** con RIR periodizado específicos para ILCA 7 (Laser)
- **Seguimiento nutricional** — plan Ivonne (Bullshark Nutrition Team) + gap proteína
- **Registro de pesos** — historial por ejercicio con gráficas de progreso SVG

## Stack técnico

```
Backend:   Node.js + Express 4
Base datos: JSON file store  (./data/tucoach.json — generado localmente, fuera del repo)
Frontend:  HTML + CSS + JS vanilla (sin frameworks)
Auth:      JWT
Wearables: Garmin Connect API + Whoop Developer API
IA:        5 agentes locales JS puro (sin OpenAI / sin Anthropic)
```

## Inicio rápido

### 1. Clonar e instalar
```bash
git clone https://github.com/TU_USUARIO/tu-coach.git
cd tu-coach
npm install
```

### 2. Configurar credenciales (opcional — app corre sin ellas en modo demo)
```bash
cp .env.example .env
# Edita .env con tus credenciales de Garmin y Whoop
```

### 3. Iniciar
```bash
npm start
# Abre: http://localhost:3001/login.html
```

La primera vez que arranques, el servidor crea `data/tucoach.json` automáticamente desde el seed con el plan completo de 63 sesiones.

**Credenciales demo:**

| Rol | Email | Contraseña |
|---|---|---|
| Coach | `coach@tucoach.app` | `TuCoach2026!` |
| Atleta | `gerardo@tucoach.app` | `TuCoach2026!` |

## Estructura del proyecto

```
tu-coach/
├── server.js                 # Servidor Express + todos los endpoints
├── agents-system.js          # Motor de 5 agentes de IA locales (fase-aware)
├── api-client.js             # Cliente HTTP compartido
├── athlete-dashboard.html    # Dashboard completo del atleta (~440kb)
├── athlete-analytics.html    # Gráficas y análisis avanzado
├── coach-dashboard.html      # Panel del entrenador
├── login.html                # Autenticación
├── data/
│   ├── tucoach.seed.json     # Base de datos inicial ✓ (incluida en repo)
│   └── tucoach.json          # BD local con datos reales ✗ (.gitignore)
├── .env.example              # Plantilla de variables de entorno
├── sync.sh                   # Script para actualizar GitHub en un comando
└── package.json
```

## Plan de entrenamiento (CAC Games 2026 · ILCA 7)

El seed incluye el plan completo — 63 sesiones estructuradas:

| Fase | Fechas | TSS/sem | RIR gym | Enfoque |
|---|---|---|---|---|
| F1 Base Técnica | Jun 7–21 | 360 | 3-4 | Técnica + base aeróbica + fuerza general |
| F2 Carga | Jun 22–Jul 12 | 490 | 1-2 | Fuerza máxima + potencia explosiva |
| F3 Especificidad | Jul 13–26 | 430 | 0-1 | Potencia específica vela + pico CTL |
| F4 Taper | Jul 27–Ago 1 | 160 | 3-4 | Reducción de carga + activación pico |
| CAC Games | Ago 1–8 | — | — | Regatas ILCA 7 · máximo rendimiento |

## Programas de fuerza élite (ILCA 7)

Tres programas periodizados con supersets y ejercicios específicos de vela:

- **F1 `strength_gen`** — Supersets hiking + cadena posterior + tracción escota
- **F2 `strength_max`** — Complejos fuerza máxima + box jump + hiking carga extrema  
- **F3 `strength_peak`** — Complejos olímpicos + sissy squat máximo + PR chin-up

Cada ejercicio tiene badge de **RIR** (Reps In Reserve) y **%RM**, con input para registrar el peso cargado y gráfica de progreso.

## Agentes de IA (sin API externa)

5 agentes locales que corren en JS puro. Conocen la fase activa del plan, el deporte (ILCA 7) y adaptan su análisis en tiempo real:

| Agente | Qué analiza |
|---|---|
| 📊 Datos | PMC, Whoop, TSS semanal vs objetivo de la fase |
| ⚙️ Sistemas | Salud de conexiones Garmin/Whoop/BD |
| 💪 Físico | Estado de carga, RIR del día, tipo de entreno |
| 🥗 Nutrición | Plan Ivonne, gap proteína, estrategia por fase |
| 🤖 CEO | Veredicto ejecutivo + acción recomendada del día |

## Endpoints principales

```
POST /auth/login
GET  /api/athlete/today                     → workout + wellness de hoy
GET  /api/athlete/ai-analysis               → radar scores + insights IA
GET  /api/athlete/pmc/data                  → CTL/ATL/TSB
GET  /api/athlete/strength-history          → historial de pesos por ejercicio
PUT  /api/athlete/workouts/:id/strength-log → registrar pesos de sesión
POST /api/agents/run                        → pipeline completo de 5 agentes
GET  /api/agents/stream?token=...           → SSE streaming con typewriter
GET  /api/athlete/garmin/sync               → pull Garmin Connect
```

## Actualizar GitHub

Un solo comando para sincronizar cambios:
```bash
./sync.sh "descripción del cambio"
```

---

Desarrollado con [Claude Code](https://claude.ai/code) · Plan CAC Games 2026 · ILCA 7 · Coach Erick
