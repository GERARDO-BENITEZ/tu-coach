      # Tu Coach — Setup para desarrollo

## Requisitos previos
- Node.js 20+
- PostgreSQL 15+
- npm o pnpm

---

## 1. Base de datos (PostgreSQL)

### Opción A — Docker (recomendado)
```bash
docker run --name tu-coach-db \
  -e POSTGRES_USER=tucoach \
  -e POSTGRES_PASSWORD=tucoach123 \
  -e POSTGRES_DB=tu_coach_dev \
  -p 5432:5432 \
  -d postgres:15
```

### Opción B — PostgreSQL local
Crear la BD manualmente en psql:
```sql
CREATE DATABASE tu_coach_dev;Listo
CREATE USER tucoach WITH PASSWORD 'tucoach123';
GRANT ALL PRIVILEGES ON DATABASE tu_coach_dev TO tucoach;
```

---

## 2. Backend API (Fastify + Prisma)

```bash
cd api

# Copiar variables de entorno
cp .env.example .env

# Editar .env con tu DATABASE_URL:
# DATABASE_URL="postgresql://tucoach:tucoach123@localhost:5432/tu_coach_dev"

# Instalar dependencias
npm install

# Generar cliente Prisma
npm run db:generate

# Correr migraciones (crea las tablas)
npm run db:migrate

# Cargar datos de prueba
npm run db:seed

# Arrancar en modo desarrollo (con hot reload)
npm run dev
```

La API quedará en: **http://localhost:3001**

### Endpoints principales
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/auth/register` | Registrar usuario |
| POST | `/auth/login` | Login → token JWT |
| GET  | `/api/athlete/today` | Entreno + wellness + nutrición del día |
| GET  | `/api/athlete/calendar` | Semana completa |
| POST | `/api/athlete/wellness` | Check-in matutino |
| POST | `/api/athlete/sensation` | Sensación post-entreno |
| GET  | `/api/coach/athletes` | Roster del coach |
| POST | `/api/coach/workouts` | Crear entreno |
| POST | `/api/coach/workouts/:id/assign` | Asignar entreno a atleta |
| GET  | `/api/coach/team/today` | Vista del equipo hoy |
| POST | `/api/nutrition/plans` | Nutriólogo sube plan |
| GET  | `/api/nutrition/today` | Plan nutricional del día |

---

## 3. Usuarios de prueba (del seed)

| Rol | Email | Password |
|-----|-------|----------|
| Coach | coach@tucoach.app | TuCoach2026! |
| Nutriólogo | nutricion@tucoach.app | TuCoach2026! |
| Atleta (Gerardo) | gerardo@tucoach.app | TuCoach2026! |
| Atleta (Ana) | ana@tucoach.app | TuCoach2026! |
| Atleta (Carlos) | carlos@tucoach.app | TuCoach2026! |

---

## 4. Cron Jobs (automáticos a las 12:00 AM)

El servidor corre automáticamente estas tareas:
- **00:00** → Recalcula PMC (CTL/ATL/TSB) para todos los atletas
- **00:00** → Marca workouts pendidos del día anterior como MISSED
- **00:00** → Genera alertas HRV del equipo
- **Cada hora** → Sync de Garmin/Whoop (Fase 2)

---

## 5. Explorar la BD

```bash
cd api
npm run db:studio
# Abre http://localhost:5555 — UI visual de la BD
```

---

## 6. Próximos pasos — Frontend Next.js

```bash
# En la raíz del proyecto
npx create-next-app@latest web \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --import-alias "@/*"

cd web
npm install
npm run dev
# Frontend en http://localhost:3000
```

El frontend Next.js consumirá la API en `http://localhost:3001`.
