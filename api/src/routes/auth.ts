import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  role: z.enum(['COACH', 'ATHLETE', 'NUTRITIONIST']).default('ATHLETE'),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export async function authRoutes(app: FastifyInstance) {

  // POST /auth/register
  app.post('/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body)
    const exists = await prisma.user.findUnique({ where: { email: body.email } })
    if (exists) return reply.status(409).send({ error: 'Email ya registrado' })

    const hashed = await bcrypt.hash(body.password, 12)
    const user = await prisma.user.create({
      data: { email: body.email, password: hashed, name: body.name, role: body.role },
    })

    // Crear perfil de atleta automáticamente
    if (body.role === 'ATHLETE') {
      await prisma.athleteProfile.create({ data: { userId: user.id } })
    }

    const token = app.jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      { expiresIn: '15m' }
    )
    const refreshToken = app.jwt.sign(
      { id: user.id, type: 'refresh' },
      { expiresIn: '30d' }
    )

    return reply.status(201).send({
      token,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    })
  })

  // POST /auth/login
  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body)
    const user = await prisma.user.findUnique({ where: { email: body.email } })
    if (!user || !user.isActive) return reply.status(401).send({ error: 'Credenciales inválidas' })

    const valid = await bcrypt.compare(body.password, user.password)
    if (!valid) return reply.status(401).send({ error: 'Credenciales inválidas' })

    const token = app.jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      { expiresIn: '15m' }
    )
    const refreshToken = app.jwt.sign(
      { id: user.id, type: 'refresh' },
      { expiresIn: '30d' }
    )

    return {
      token,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    }
  })

  // POST /auth/refresh
  app.post('/auth/refresh', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string }
    try {
      const payload = app.jwt.verify(refreshToken) as { id: string; type: string }
      if (payload.type !== 'refresh') throw new Error()
      const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.id } })
      const token = app.jwt.sign(
        { id: user.id, email: user.email, role: user.role, name: user.name },
        { expiresIn: '15m' }
      )
      return { token }
    } catch {
      return reply.status(401).send({ error: 'Refresh token inválido' })
    }
  })

  // GET /auth/me
  app.get('/auth/me', { onRequest: [app.authenticate] }, async (request) => {
    const { id } = request.user as { id: string }
    const user = await prisma.user.findUniqueOrThrow({
      where: { id },
      include: { profile: true },
      omit: { password: true },
    })
    return user
  })
}
