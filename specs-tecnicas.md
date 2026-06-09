# Tu Coach — Especificaciones Técnicas Completas

> Plataforma de coaching deportivo al estilo TrainingPeaks con integración Garmin + Whoop

---

## Arquitectura General

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTES                                  │
│  Web App (Next.js)  │  iOS App  │  Android App  │  Garmin Watch │
└──────────┬──────────┴─────┬─────┴──────┬────────┴───────┬───────┘
           │                │            │                │
           └────────────────┴────────────┘                │
                            │                    Garmin Connect IQ
                     API Gateway (REST)                   │
                            │                             │
         ┌──────────────────┴──────────────────────┐      │
         │           Backend (Node.js)              │←─────┘
         │  Auth │ Plans │ Workouts │ Analytics │   │
         └──┬────┴───┬───┴────┬─────┴─────┬────┘   │
            │        │        │           │
      PostgreSQL   Redis    S3/R2    InfluxDB
      (principal) (caché)  (files)  (time-series)
            │
     ┌──────┴──────┐
     │  Webhook    │
     │  Listener   │
     └──┬──────┬───┘
        │      │
    Garmin    Whoop
    Connect   API v1
    API v1
```

---

## Stack Tecnológico Detallado

### Frontend Web
| Tecnología | Versión | Uso |
|-----------|---------|-----|
| Next.js | 14+ (App Router) | Framework principal |
| TypeScript | 5+ | Tipado estático |
| Tailwind CSS | 3+ | Estilos utilitarios |
| Recharts / Victory | latest | Gráficas PMC, zonas |
| React Query | v5 | Server state & sincronización |
| Zustand | v4 | Estado local UI |
| Framer Motion | v10 | Animaciones |
| date-fns | v3 | Manejo de fechas |

### App Móvil
| Tecnología | Versión | Uso |
|-----------|---------|-----|
| React Native + Expo | SDK 51 | App iOS y Android |
| Expo Router | v3 | Navegación |
| Expo Notifications | latest | Push notifications |
| React Native Reanimated | v3 | Animaciones nativas |
| WatermelonDB | latest | Offline-first storage |

### Backend
| Tecnología | Versión | Uso |
|-----------|---------|-----|
| Node.js + Fastify | v4 | API principal |
| TypeScript | 5+ | Tipado |
| Prisma ORM | v5 | Acceso a PostgreSQL |
| Bull / BullMQ | v4 | Colas de tareas (sync, notifs) |
| ioredis | v5 | Redis client |
| zod | v3 | Validación de schemas |
| jsonwebtoken | latest | JWT auth |

### Bases de Datos
| DB | Uso |
|----|-----|
| PostgreSQL 16 | Usuarios, planes, entrenamientos, atletas-coach |
| Redis 7 | Caché de sesiones, rate limiting, pub/sub |
| InfluxDB 2.7 | Series temporales: HRV, FC, potencia, CTL/ATL histórico |
| S3 / Cloudflare R2 | Archivos .fit, imágenes, mapas GPX |

### Infraestructura
| Servicio | Uso |
|---------|-----|
| Vercel | Frontend Next.js |
| Railway / Render | Backend Node.js |
| Supabase | PostgreSQL + Auth + Storage (alternativa managed) |
| Cloudflare | CDN + DNS + R2 storage |
| OneSignal | Push notifications web y móvil |
| Resend | Emails transaccionales |
| Stripe | Pagos y suscripciones |

---

## Modelo de Base de Datos

### Tabla: users
```sql
id              UUID PRIMARY KEY
email           VARCHAR UNIQUE NOT NULL
password_hash   VARCHAR
role            ENUM('athlete', 'coach', 'admin')
name            VARCHAR
avatar_url      VARCHAR
timezone        VARCHAR DEFAULT 'America/Mexico_City'
created_at      TIMESTAMP
```

### Tabla: athletes
```sql
id              UUID PRIMARY KEY
user_id         UUID REFERENCES users(id)
coach_id        UUID REFERENCES coaches(id)
sport           VARCHAR[]  -- ['triathlon', 'cycling', 'running']
ftp_cycling     INT        -- watts
ftp_running     INT        -- pace in sec/km
lthr            INT        -- bpm umbral láctico
weight          DECIMAL
height          INT
birth_date      DATE
garmin_user_id  VARCHAR    -- ID en Garmin Connect
whoop_user_id   VARCHAR    -- ID en Whoop
```

### Tabla: coaches
```sql
id              UUID PRIMARY KEY
user_id         UUID REFERENCES users(id)
bio             TEXT
certifications  VARCHAR[]
specialties     VARCHAR[]
max_athletes    INT DEFAULT 20
stripe_account  VARCHAR    -- para pagos
```

### Tabla: training_plans
```sql
id              UUID PRIMARY KEY
coach_id        UUID REFERENCES coaches(id)
name            VARCHAR
description     TEXT
sport           VARCHAR
duration_weeks  INT
phase           ENUM('base', 'build', 'peak', 'taper', 'race')
is_template     BOOLEAN DEFAULT false
tss_per_week    INT[]      -- TSS objetivo por semana
created_at      TIMESTAMP
```

### Tabla: workouts
```sql
id              UUID PRIMARY KEY
plan_id         UUID REFERENCES training_plans(id)
coach_id        UUID REFERENCES coaches(id)
name            VARCHAR NOT NULL
description     TEXT
sport           ENUM('cycling', 'running', 'swimming', 'strength', 'rest', 'other')
workout_type    ENUM('base', 'tempo', 'intervals', 'long', 'race', 'recovery', 'strength')
duration_sec    INT
tss_target      INT
rpe_target      INT        -- 1-10
instructions    TEXT
segments        JSONB      -- array de segmentos estructurados
garmin_workout_id VARCHAR  -- ID en Garmin Connect tras push
created_at      TIMESTAMP
```

### Tabla: workout_segments (JSONB dentro de workouts.segments)
```json
[
  {
    "order": 1,
    "name": "Calentamiento",
    "duration_sec": 900,
    "repetitions": 1,
    "intensity_type": "power_zone",
    "zone": 2,
    "power_min_pct": 56,
    "power_max_pct": 75,
    "hr_min": null,
    "hr_max": null,
    "pace_min": null,
    "pace_max": null
  }
]
```

### Tabla: athlete_workouts (asignación)
```sql
id              UUID PRIMARY KEY
athlete_id      UUID REFERENCES athletes(id)
workout_id      UUID REFERENCES workouts(id)
scheduled_date  DATE NOT NULL
status          ENUM('planned', 'completed', 'skipped', 'modified')
-- Datos post-entreno (de Garmin)
actual_duration_sec    INT
actual_tss             INT
actual_distance_m      INT
actual_avg_hr          INT
actual_max_hr          INT
actual_avg_power       INT
actual_np              INT
actual_if              DECIMAL
actual_avg_pace        INT
actual_elevation_m     INT
-- RPE y notas
rpe_actual             INT        -- 1-10 reportado por atleta
athlete_notes          TEXT
coach_feedback         TEXT
-- Datos Whoop del día
whoop_recovery_score   INT        -- % recuperación ese día
whoop_hrv              DECIMAL    -- ms
whoop_rhr              INT        -- bpm
whoop_sleep_hours      DECIMAL
-- Garmin activity
garmin_activity_id     VARCHAR
fit_file_url           VARCHAR    -- S3
completed_at           TIMESTAMP
```

### Tabla: pmc_daily (calculada, time-series)
```sql
id              UUID PRIMARY KEY
athlete_id      UUID REFERENCES athletes(id)
date            DATE NOT NULL
ctl             DECIMAL  -- Chronic Training Load (42-day EWA)
atl             DECIMAL  -- Acute Training Load (7-day EWA)
tsb             DECIMAL  -- Training Stress Balance (CTL - ATL)
tss_day         INT      -- TSS del día
UNIQUE(athlete_id, date)
```

### Tabla: biometrics_daily (de Garmin + Whoop)
```sql
id                    UUID PRIMARY KEY
athlete_id            UUID REFERENCES athletes(id)
date                  DATE NOT NULL
-- Whoop
whoop_recovery_pct    INT
whoop_hrv_ms          DECIMAL
whoop_rhr_bpm         INT
whoop_sleep_hours     DECIMAL
whoop_sleep_eff_pct   INT
whoop_sleep_debt_min  INT
whoop_strain          DECIMAL
whoop_spo2            DECIMAL
-- Garmin
garmin_body_battery   INT
garmin_stress_avg     INT
garmin_rhr_bpm        INT
garmin_steps          INT
garmin_sleep_hours    DECIMAL
-- Calculados
recovery_status       ENUM('red', 'yellow', 'green', 'peak')
alert_triggered       BOOLEAN DEFAULT false
alert_type            VARCHAR
UNIQUE(athlete_id, date)
```

### Tabla: messages
```sql
id              UUID PRIMARY KEY
from_user_id    UUID REFERENCES users(id)
to_user_id      UUID REFERENCES users(id)
content         TEXT NOT NULL
workout_ref_id  UUID REFERENCES athlete_workouts(id)
read_at         TIMESTAMP
created_at      TIMESTAMP
```

---

## API Endpoints

### Auth
```
POST /auth/register          Registro atleta o coach
POST /auth/login             Login + JWT
POST /auth/refresh           Refresh token
GET  /auth/me                Usuario actual
```

### Integrations
```
GET  /integrations/garmin/connect      OAuth URL para conectar Garmin
GET  /integrations/garmin/callback     Callback OAuth Garmin
POST /integrations/garmin/sync         Sync manual
DELETE /integrations/garmin            Desconectar

GET  /integrations/whoop/connect       OAuth URL para conectar Whoop
GET  /integrations/whoop/callback      Callback OAuth Whoop
POST /integrations/whoop/sync          Sync manual
DELETE /integrations/whoop             Desconectar

POST /webhooks/garmin                  Recibir webhook de Garmin (actividades nuevas)
POST /webhooks/whoop                   Recibir webhook de Whoop (ciclos de sueño)
```

### Coach
```
GET    /coach/athletes                 Lista atletas del coach
GET    /coach/athletes/:id             Detalle atleta + PMC + biometrics
POST   /coach/athletes/invite          Invitar atleta
GET    /coach/athletes/:id/calendar    Calendario del atleta (semana/mes)
GET    /coach/alerts                   Alertas activas de todos los atletas

GET    /coach/plans                    Planes del coach
POST   /coach/plans                    Crear plan
GET    /coach/plans/:id                Detalle plan
PUT    /coach/plans/:id                Editar plan
DELETE /coach/plans/:id                Eliminar plan
POST   /coach/plans/:id/assign         Asignar plan a atleta

GET    /coach/workouts                 Biblioteca de entrenos
POST   /coach/workouts                 Crear entreno
PUT    /coach/workouts/:id             Editar entreno
DELETE /coach/workouts/:id             Eliminar entreno
POST   /coach/workouts/:id/push-garmin Enviar entreno al reloj Garmin del atleta
```

### Athlete
```
GET  /athlete/calendar?week=2026-W24   Calendario semanal
GET  /athlete/today                    Entreno de hoy + recuperación actual
GET  /athlete/pmc                      Datos PMC (CTL, ATL, TSB histórico)
GET  /athlete/activities               Historial de actividades
GET  /athlete/activities/:id           Detalle actividad + archivo .fit
GET  /athlete/biometrics               Historial biometrics Garmin + Whoop
GET  /athlete/biometrics/today         Datos de hoy (recovery, HRV, etc.)

POST /athlete/workouts/:id/complete    Marcar como completado + RPE
POST /athlete/workouts/:id/skip        Marcar como omitido + razón
PUT  /athlete/workouts/:id/notes       Añadir notas post-entreno
```

### Analytics
```
GET  /analytics/pmc/:athleteId         PMC completo (CTL/ATL/TSB histórico)
GET  /analytics/zones/:athleteId       Distribución de zonas (periodo)
GET  /analytics/compliance/:athleteId  % compliance histórico
GET  /analytics/fitness/:athleteId     Progresión FTP, VO2max, TSS
GET  /analytics/team                   Analytics agregado de todos los atletas
```

---

## Integración Garmin Connect API

### OAuth 2.0 Flow
```
1. Coach/atleta click "Conectar Garmin"
2. Redirect a → https://connect.garmin.com/oauthConfirm
   params: client_id, redirect_uri, scope, state
3. Usuario aprueba permisos en Garmin
4. Garmin redirect a → /integrations/garmin/callback?code=XXX
5. Backend exchange code por access_token + refresh_token
6. Guardar tokens en tabla integrations (encriptados con AES-256)
7. Registrar webhook URL en Garmin: POST /wellness-api/rest/user/registrations
```

### Scopes requeridos
```
ACTIVITY_EXPORT   - Descargar actividades y archivos .fit
ACTIVITY_IMPORT   - Subir/push entrenamientos estructurados al reloj
COURSE            - Rutas GPS
SLEEP             - Datos de sueño
DAILY_SUMMARY     - Body Battery, estrés, pasos
HEART_RATE        - FC en reposo y continua
```

### Webhook payload (Garmin → Tu Coach)
```json
{
  "activityFiles": [
    {
      "userId": "garmin_user_123",
      "userAccessToken": "xxx",
      "fileType": "FIT",
      "callbackURL": "https://connectapi.garmin.com/..."
    }
  ]
}
```

### Push workout al reloj Garmin
```json
POST https://connectapi.garmin.com/workout-service/workout
{
  "workoutName": "Rodada Z3 Intervals",
  "sport": "cycling",
  "estimatedDurationInSecs": 5400,
  "workoutSegments": [
    {
      "segmentName": "Calentamiento",
      "sport": "cycling",
      "workoutSteps": [
        {
          "type": "WorkoutStep",
          "stepOrder": 1,
          "intensity": "WARMUP",
          "durationType": "TIME",
          "durationValue": 900,
          "targetType": "POWER",
          "targetValueLow": 160,
          "targetValueHigh": 213
        }
      ]
    }
  ]
}
```

---

## Integración Whoop API v1

### OAuth 2.0 Flow
```
1. Click "Conectar Whoop"
2. Redirect a → https://api.prod.whoop.com/oauth/oauth2/auth
   scopes: read:recovery read:sleep read:workout read:body_measurement
3. Callback con code → exchange por token
4. Registrar webhook: POST /developer/v1/webhook
   eventos: recovery.updated, sleep.updated, workout.updated
```

### Webhook payload (Whoop → Tu Coach)
```json
{
  "user_id": 10129,
  "event": "recovery.updated",
  "data": {
    "id": 12345,
    "cycle_id": 7894,
    "created_at": "2026-06-07T07:15:00Z",
    "score": {
      "recovery_score": 73,
      "resting_heart_rate": 42,
      "hrv_rmssd_milli": 58.2,
      "spo2_percentage": 96.0,
      "skin_temp_celsius": 34.1
    }
  }
}
```

### Lógica de alertas HRV
```typescript
function evaluateHRV(todayHRV: number, baselineMin: number, baselineMax: number): AlertLevel {
  const mean = (baselineMin + baselineMax) / 2;
  const sd = (baselineMax - baselineMin) / 4; // aprox
  const zScore = (todayHRV - mean) / sd;

  if (zScore < -3) return 'RED';    // HRV crítico → modificar plan obligatorio
  if (zScore < -1) return 'YELLOW'; // HRV bajo → notificar coach
  if (zScore > 2)  return 'PEAK';   // HRV elevado → considerar aumentar carga
  return 'GREEN';
}
```

---

## Cálculo PMC (Performance Management Chart)

```typescript
// CTL: Chronic Training Load (fitness) — EWA 42 días
// ATL: Acute Training Load (fatiga) — EWA 7 días
// TSB: Training Stress Balance (forma) = CTL - ATL

const CTL_TAU = 42;
const ATL_TAU = 7;

function updatePMC(prevCTL: number, prevATL: number, todayTSS: number) {
  const ctl = prevCTL + (todayTSS - prevCTL) * (1 - Math.exp(-1 / CTL_TAU));
  const atl = prevATL + (todayTSS - prevATL) * (1 - Math.exp(-1 / ATL_TAU));
  const tsb = ctl - atl;
  return { ctl, atl, tsb };
}

// TSS fuentes:
// - Ciclismo: TSS = (sec * NP * IF) / (FTP * 3600) * 100
// - Running:  rTSS basado en ritmo vs threshold pace
// - Natación: sTSS basado en CSS (Critical Swim Speed)
// - Fuerza:   TSS manual del coach o por RPE (RPE * 10 * durMin / 60)
// - Whoop:    strain normalizado puede complementar TSS
```

---

## Sistema de Gráficas — 100% Visualización de Desarrollo

> Inspirado en TrainingPeaks pero más visual, más emocional y conectado con nutrición y sensaciones.

### 1. PMC — Performance Management Chart (Core)
La gráfica más importante. Muestra fitness, fatiga y forma en el tiempo.

| Métrica | Descripción | Color |
|---------|-------------|-------|
| CTL (Fitness) | EWA 42 días — qué tan entrenado estás | Azul |
| ATL (Fatiga) | EWA 7 días — qué tan cansado estás | Rojo |
| TSB (Forma) | CTL - ATL — qué tan listo estás para competir | Verde |
| TSS diario | Barra de carga del día | Gris |

**Rangos TSB para el atleta:**
- `> +25` → Desentrenado, muy descansado
- `+10 a +25` → Zona óptima de carrera / competencia
- `0 a +10` → Bien entrenado, levemente fatigado
- `-10 a 0` → Entrenamiento productivo
- `< -30` → Zona de riesgo de sobreentrenamiento

**Interactividad:** Hover muestra burbuja con fecha, CTL, ATL, TSB, TSS del día, recovery Whoop de ese día.

---

### 2. Fitness History — Picos de Rendimiento
Muestra los mejores esfuerzos históricos del atleta por duración.

**Ciclismo — Curva de potencia (Mean Max Power):**
```
5s / 10s / 30s / 1min / 5min / 20min / 60min / 90min
```
- Línea de este año vs línea de mejor histórico
- Zona sombreada de 90 días más recientes
- Marca automática cuando se rompe un PR personal

**Running — Curva de pace (Mean Best Pace):**
```
400m / 800m / 1km / 5km / 10km / 21km / 42km
```

**Natación — Curva de velocidad por distancia:**
```
50m / 100m / 200m / 400m / 800m / 1500m
```

---

### 3. Distribución de Zonas de Entrenamiento
Gráfica de dona/barras mostrando tiempo por zona (semana / mes / temporada).

**Por zona de potencia (ciclismo):**
```
Z1 Recuperación | Z2 Base | Z3 Tempo | Z4 Umbral | Z5 VO2max | Z6 Anaeróbico | Z7 Neuromuscular
```

**Por zona de FC (running/natación):**
```
Z1 (<60%) | Z2 (60-70%) | Z3 (70-80%) | Z4 (80-90%) | Z5 (>90%)
```

**Por pace/ritmo (running):**
```
Fácil | Moderado | Tempo | Umbral | Intervalo | Sprint
```

**Rango visible:** 7 días / 4 semanas / 3 meses / temporada completa

---

### 4. Dashboard de Progresión del Atleta
Gráficas lineales de evolución en el tiempo:

| Gráfica | Qué muestra | Eje X |
|---------|-------------|-------|
| FTP Ciclismo | Watts a lo largo del tiempo | Fechas de test |
| FTP Running | Pace de umbral | Fechas de test |
| Peso corporal | kg + trend line | Diario/semanal |
| HRV baseline | ms — si mejora, mejora la forma | Diario |
| FC en reposo | bpm basal | Diario |
| VO2max estimado | ml/kg/min (Garmin) | Por fecha |

---

### 5. Compliance Chart — Cumplimiento del Plan
Gráfica de barras apiladas por semana:

```
Verde  = completado al 100%
Naranja = completado parcialmente / modificado
Rojo   = omitido / no completado
```

- Vista semanal con % global
- Vista mensual por tipo de sesión (ciclismo, running, fuerza, etc.)
- Tendencia de compliance últimas 12 semanas

---

### 6. Carga Semanal Acumulada
Barras de volumen e intensidad por semana:

| Columna | Contenido |
|---------|-----------|
| Horas totales | Tiempo de entreno por semana |
| TSS semanal | Carga total de la semana |
| TSS objetivo | Lo que el coach planeó |
| Distancia | km acumulados (por deporte) |

Línea de tendencia de 4, 8 y 12 semanas. Fácil ver si la carga progresa o estanca.

---

### 7. Comparativa Planificado vs Real
Por cada semana: barras comparando lo que el coach planeó vs lo que el atleta ejecutó.

```
Semana 12:  Planificado 450 TSS ──── Real 420 TSS (93%)
Semana 13:  Planificado 500 TSS ──── Real 380 TSS (76%) [semana difícil]
```

---

### 8. Biométricos Integrados (Whoop + Garmin)
Gráfica multi-línea con variables superpuestas:

- Recovery score (%) — Whoop
- HRV (ms) — Whoop
- FC reposo (bpm) — Garmin/Whoop
- Body Battery (%) — Garmin
- Calidad de sueño (hrs efectivas) — Whoop

**Correlación visual:** Si el atleta entrena fuerte un día, al día siguiente se ve el impacto en recovery y HRV.

---

### 9. Gráficas de Sensaciones (exclusivo Tu Coach)
Gráficas de 0–10 acumuladas por semana:

| Sensación | Qué mide |
|-----------|----------|
| Piernas | Frescura muscular percibida |
| Cabeza | Estado mental / motivación |
| Energía | Nivel de energía general |
| Dolor | Molestias o dolores |
| Sueño | Calidad de sueño percibida |
| Estrés | Estrés externo (trabajo, vida) |

**Vista:** Radar chart semanal + líneas de tendencia por mes. El coach ve si un atleta tiene piernas excelentes pero cabeza apagada, o estrés alto que explica mal rendimiento.

---

### 10. Gráficas de Nutrición
Barras de macros diarios con comparativa vs objetivo:

```
Lunes:  Carbs 280g / Proteína 165g / Grasas 72g  [objetivo: 300/160/70]
```

- Calórico: consumido vs quemado (entreno + basal)
- Hidratación: litros por día
- Timing de comidas: desayuno pre/post, comida, cena, snacks
- Tendencia de 7 / 30 días

---

## Sistema de Sensaciones Post-Entreno

> Lo que TrainingPeaks llama "Subjective Feedback" — Tu Coach lo expande a entrenamiento + alimentación + bienestar general.

### Flujo al completar un entreno

El atleta recibe una notificación 30 min después de terminar el entreno (o al marcar como completado). Se abre una pantalla rápida de 3 pasos:

**Paso 1 — ¿Cómo fue el esfuerzo?**
```
RPE (1-10): [ slider visual con etiquetas ]
  1-2 Muy fácil | 3-4 Fácil | 5-6 Moderado | 7-8 Duro | 9-10 Máximo
```

**Paso 2 — ¿Cómo te sientes ahora?**
```
Emojis de 5 niveles:
😴 Agotado  😔 Cansado  😐 Bien  😊 Con energía  🔥 Excelente

Sliders rápidos (0-10):
• Piernas: ___
• Cabeza/Motivación: ___
• Dolor o molestia: ___  [si > 5, pide ubicación del dolor]
```

**Paso 3 — Nota libre (opcional)**
```
Texto libre: "¿Algo que quieras contarle a tu coach?"
```

### Tabla: workout_sensations
```sql
id                UUID PRIMARY KEY
athlete_workout_id UUID REFERENCES athlete_workouts(id)
rpe               INT           -- 1-10
feeling           INT           -- 1-5 (1=agotado, 5=excelente)
legs_score        INT           -- 0-10
mental_score      INT           -- 0-10
pain_score        INT           -- 0-10
pain_location     VARCHAR       -- si pain_score > 5
energy_score      INT           -- 0-10
athlete_note      TEXT
coach_visible     BOOLEAN DEFAULT true
recorded_at       TIMESTAMP
```

---

## Sistema de Sensaciones de Alimentación

> Nuevo módulo: el atleta registra cómo comió y cómo se sintió con esa alimentación. Vinculado al entreno del día.

### Check-in diario de nutrición

Se activa cada día al mediodía (o configurable por el atleta). Una pantalla rápida de 2 minutos:

**Bloque: ¿Cómo fue tu alimentación hoy?**
```
Cumplí con el plan nutricional:  [ Nada / Poco / Más o menos / Bien / Al 100% ]

Hidratación:  [ 😵 Muy poco / 💧 Poco / 🆗 Normal / 💦 Bien / 🌊 Perfecto ]

Comí pre-entreno:    Sí / No / No había entreno
Comí post-entreno:   Sí / No / No había entreno
Antojo / comida no planeada: Sí / No → (¿qué?)

Cómo me sentí con lo que comí:
  Energía durante entreno: 0-10 ___
  Digestión:               0-10 ___
  Saciedad el día:         0-10 ___
  
Nota libre: "¿Algo especial con la alimentación?"
```

### Tabla: nutrition_sensations
```sql
id                      UUID PRIMARY KEY
athlete_id              UUID REFERENCES athletes(id)
date                    DATE NOT NULL
plan_compliance         INT       -- 1-5 (1=nada, 5=al 100%)
hydration_score         INT       -- 1-5
pre_workout_fueled      BOOLEAN
post_workout_fueled     BOOLEAN
unplanned_food          BOOLEAN
unplanned_food_note     TEXT
energy_during_workout   INT       -- 0-10
digestion_score         INT       -- 0-10
satiety_score           INT       -- 0-10
athlete_note            TEXT
recorded_at             TIMESTAMP
UNIQUE(athlete_id, date)
```

---

## Tabla: daily_wellness (Check-in matutino)

Cada mañana, antes de ver el entreno del día, el atleta hace un check-in de bienestar de 30 segundos:

```sql
id              UUID PRIMARY KEY
athlete_id      UUID REFERENCES athletes(id)
date            DATE NOT NULL
sleep_quality   INT       -- 0-10 (qué tan bien dormí)
sleep_hours     DECIMAL   -- horas dormidas reportadas
stress_level    INT       -- 0-10 (estrés externo)
mood            INT       -- 1-5 (1=muy mal, 5=excelente)
soreness        INT       -- 0-10 (dolor muscular general)
motivation      INT       -- 0-10
ready_to_train  BOOLEAN   -- ¿siente que puede entrenar?
athlete_note    TEXT
recorded_at     TIMESTAMP
UNIQUE(athlete_id, date)
```

**Pantalla del check-in matutino (en app móvil, antes de ver el plan):**
```
Buenos días, Gerardo 🌅

¿Cómo amaneciste hoy?
  😴 ¿Cuántas horas dormiste?  [ruedita: 4-12h]
  ⚡ ¿Cómo está tu energía?    [1-5 caras]
  💪 ¿Cómo están los músculos? [slider 0-10]
  🧠 ¿Cómo está tu cabeza?     [1-5 caras]
  😰 ¿Nivel de estrés hoy?     [0-10]

[Ver mi entreno de hoy →]
```

---

## API Endpoints — Sensaciones y Wellness

```
POST /athlete/workouts/:id/sensations       Registrar sensaciones post-entreno
GET  /athlete/workouts/:id/sensations       Ver sensaciones de un entreno
GET  /athlete/sensations/history            Historial de sensaciones (con filtros)

POST /athlete/nutrition/log                 Check-in diario de nutrición
GET  /athlete/nutrition/history             Historial de nutrición + sensaciones

POST /athlete/wellness/daily                Check-in matutino de bienestar
GET  /athlete/wellness/history              Historial de wellness diario

GET  /coach/athletes/:id/sensations         Coach ve sensaciones de un atleta
GET  /coach/athletes/:id/wellness           Coach ve wellness histórico
GET  /coach/athletes/:id/nutrition          Coach ve adherencia nutricional
GET  /coach/team/wellness-overview          Vista agregada de bienestar del equipo
```

---

## Notificaciones Push

### Eventos que disparan notificación
| Evento | Destinatario | Contenido |
|--------|-------------|-----------|
| Nuevo entreno asignado | Atleta | "Tu coach asignó un nuevo entreno para mañana" |
| Recuperación sincronizada | Atleta | "Recovery 73% 🟢 — Tu entreno de hoy está confirmado" |
| HRV crítico detectado | Coach | "Ana L. — HRV 32ms, 3 SD bajo baseline. Acción requerida" |
| Entreno completado | Coach | "Gerardo completó: Rodada Z3 — TSS 95, RPE 8" |
| Competencia en 7 días | Atleta | "Tu triatlón es en 7 días. Semana de tapering activada" |
| Mensaje del coach | Atleta | Preview del mensaje |
| Entreno no completado 6pm | Coach | "Jorge P. no completó el entreno de hoy" |

---

## Modelo de Negocio

### Planes de suscripción
| Plan | Precio | Límite | Características |
|------|--------|--------|-----------------|
| Coach Starter | $29/mes | 5 atletas | Calendario, plans, mensajes |
| Coach Pro | $79/mes | 15 atletas | + Analytics avanzado, Garmin push |
| Coach Elite | $149/mes | Ilimitado | + Nutrición, API access, white-label |
| Atleta Free | $0 | — | Ver entrenos del coach |
| Atleta Premium | $9/mes | — | + Analytics personal, integraciones ilimitadas |

---

## Fases de Desarrollo

### MVP — Fase 1 (10 semanas)
- [ ] Auth (registro coach / atleta, JWT)
- [ ] Coach: crear y asignar entrenos (diario/semanal)
- [ ] Atleta: ver entreno del día + marcar completado + RPE
- [ ] Calendario visual (semana y mes)
- [ ] Mensajería coach ↔ atleta
- [ ] Push notifications básicas
- [ ] Integración Garmin (OAuth + recibir actividades)
- [ ] Integración Whoop (OAuth + recibir recovery diario)
- [ ] PMC básico (CTL/ATL/TSB)

### Fase 2 — Analytics (8 semanas)
- [ ] PMC chart completo con histórico
- [ ] Dashboard de compliance semanal para coach
- [ ] Alertas inteligentes HRV / recovery
- [ ] Push de entrenamientos estructurados al reloj Garmin
- [ ] Análisis de zonas de entrenamiento
- [ ] App móvil iOS y Android (React Native)

### Fase 3 — Nutrición & Business (8 semanas)
- [ ] Módulo de nutrición (plan nutricional vinculado a entrenamiento)
- [ ] Timing de comidas automático según entreno del día
- [ ] Biblioteca de planes (marketplace de planes del coach)
- [ ] Stripe: pagos y suscripciones
- [ ] Integración Strava (importar actividades)
- [ ] API pública para integraciones externas

---

## Seguridad

- Tokens Garmin/Whoop encriptados en DB con AES-256-GCM
- JWT con refresh token rotation (access: 15min, refresh: 30 días)
- Rate limiting en todos los endpoints (Redis)
- Validación de webhooks: HMAC-SHA256 signature verification
- HTTPS obligatorio, HSTS headers
- Row-level security en PostgreSQL (atleta solo ve sus datos)
- GDPR: exportar y eliminar datos del usuario completo
