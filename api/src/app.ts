import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { authRoutes }      from './routes/auth'
import { athleteRoutes }   from './routes/athlete'
import { coachRoutes }     from './routes/coach'
import { nutritionRoutes } from './routes/nutrition'
import { startCronJobs }   from './services/cron'

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
})

// ─── Plugins ────────────────────────────────────────────────────────

app.register(cors, {
  origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  credentials: true,
})

app.register(jwt, {
  secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-prod',
})

// Decorador para que las rutas puedan usar app.authenticate
app.decorate('authenticate', async function (request: any, reply: any) {
  try {
    await request.jwtVerify()
  } catch {
    reply.status(401).send({ error: 'Token requerido o inválido' })
  }
})

// ─── Rutas ──────────────────────────────────────────────────────────

app.register(authRoutes)
app.register(athleteRoutes,   { prefix: '/api' })
app.register(coachRoutes,     { prefix: '/api' })
app.register(nutritionRoutes, { prefix: '/api' })

// Health check
app.get('/health', () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: '1.0.0',
}))

// ─── Inicio ──────────────────────────────────────────────────────────

const start = async () => {
  try {
    const port = parseInt(process.env.PORT ?? '3001')
    const host = process.env.HOST ?? '0.0.0.0'

    await app.listen({ port, host })
    console.log(`\n🚀 Tu Coach API corriendo en http://localhost:${port}`)
    console.log(`📊 Health check: http://localhost:${port}/health\n`)

    // Iniciar cron jobs (PMC a medianoche, sync cada hora)
    startCronJobs()
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()

export default app
