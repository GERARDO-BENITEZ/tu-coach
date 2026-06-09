/**
 * Rutas de Nutrición
 * POST /nutrition/plans              → nutriólogo crea plan
 * GET  /nutrition/plans/:athleteId   → obtener plan activo del atleta
 * GET  /nutrition/today              → plan del día (atleta lo llama)
 * PUT  /nutrition/plans/:id          → actualizar plan
 * POST /nutrition/sensation          → atleta registra sensación nutricional
 */

import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

const prisma = new PrismaClient()

const mealSchema = z.object({
  name:     z.string(),
  time:     z.string(),          // "07:30"
  calories: z.number().int(),
  foods: z.array(z.object({
    name:   z.string(),
    amount: z.number(),
    unit:   z.string(),          // "g" | "ml" | "pcs"
    kcal:   z.number().int(),
  })),
})

const nutritionDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  dayType:   z.enum(['REST', 'TRAINING', 'LONG', 'RACE', 'RECOVERY']),
  calories:  z.number().int().min(1),
  carbsG:    z.number().int().min(0),
  proteinG:  z.number().int().min(0),
  fatG:      z.number().int().min(0),
  meals:     z.array(mealSchema),
  notes:     z.string().optional(),
})

const planSchema = z.object({
  athleteId: z.string(),
  name:      z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:     z.string().optional(),
  days:      z.array(nutritionDaySchema).length(7),  // 7 días obligatorios
})

const nutritionSensationSchema = z.object({
  planCompliance:       z.number().int().min(1).max(5),
  hydrationScore:       z.number().int().min(1).max(5),
  preWorkoutFueled:     z.boolean().default(false),
  postWorkoutFueled:    z.boolean().default(false),
  energyDuringWorkout:  z.number().int().min(0).max(10).optional(),
  digestionScore:       z.number().int().min(0).max(10).optional(),
  note:                 z.string().max(500).optional(),
})

export async function nutritionRoutes(app: FastifyInstance) {

  app.addHook('onRequest', app.authenticate)

  // ─── POST /nutrition/plans ────────────────────────────────────────
  // Nutriólogo o coach crea el plan
  app.post('/nutrition/plans', async (request, reply) => {
    const user = request.user as { id: string; role: string }
    if (!['NUTRITIONIST', 'COACH', 'ADMIN'].includes(user.role)) {
      return reply.status(403).send({ error: 'Solo nutriólogos o coaches pueden crear planes' })
    }

    const body = planSchema.parse(request.body)

    // Desactivar plan anterior del atleta
    await prisma.nutritionPlan.updateMany({
      where: { athleteId: body.athleteId, isActive: true },
      data: { isActive: false },
    })

    const plan = await prisma.nutritionPlan.create({
      data: {
        nutritionistId: user.id,
        athleteId:      body.athleteId,
        name:           body.name,
        startDate:      new Date(body.startDate),
        endDate:        body.endDate ? new Date(body.endDate) : null,
        notes:          body.notes,
        days: {
          create: body.days,
        },
      },
      include: { days: { orderBy: { dayOfWeek: 'asc' } } },
    })

    return reply.status(201).send(plan)
  })

  // ─── GET /nutrition/plans/athlete/:athleteId ──────────────────────
  app.get<{ Params: { athleteId: string } }>('/nutrition/plans/athlete/:athleteId', async (request, reply) => {
    const user = request.user as { id: string; role: string }
    const { athleteId } = request.params

    // El atleta solo puede ver su propio plan
    if (user.role === 'ATHLETE' && user.id !== athleteId) {
      return reply.status(403).send({ error: 'Sin acceso' })
    }

    const plans = await prisma.nutritionPlan.findMany({
      where: { athleteId },
      include: { days: { orderBy: { dayOfWeek: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    })

    return plans
  })

  // ─── GET /nutrition/today ─────────────────────────────────────────
  // Atleta llama esto para ver su plan de hoy
  app.get('/nutrition/today', async (request) => {
    const { id: athleteId } = request.user as { id: string }
    const today = new Date()
    const dayOfWeek = today.getDay()  // 0=Dom, 1=Lun, ..., 6=Sáb

    const activePlan = await prisma.nutritionPlan.findFirst({
      where: {
        athleteId,
        isActive: true,
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: {
        days: { where: { dayOfWeek } },
        nutritionist: { select: { name: true, email: true } },
      },
    })

    if (!activePlan) return { plan: null, message: 'No tienes un plan nutricional activo' }

    const todayPlan = activePlan.days[0] ?? null
    return { plan: activePlan, today: todayPlan }
  })

  // ─── PUT /nutrition/plans/:id ─────────────────────────────────────
  app.put<{ Params: { id: string } }>('/nutrition/plans/:id', async (request, reply) => {
    const user = request.user as { id: string; role: string }
    if (!['NUTRITIONIST', 'COACH', 'ADMIN'].includes(user.role)) {
      return reply.status(403).send({ error: 'Sin permisos' })
    }

    const plan = await prisma.nutritionPlan.findFirst({
      where: { id: request.params.id, nutritionistId: user.id },
    })
    if (!plan) return reply.status(404).send({ error: 'Plan no encontrado' })

    const body = z.object({
      name:    z.string().optional(),
      notes:   z.string().optional(),
      endDate: z.string().optional(),
    }).parse(request.body)

    const updated = await prisma.nutritionPlan.update({
      where: { id: request.params.id },
      data: {
        ...(body.name    && { name: body.name }),
        ...(body.notes   && { notes: body.notes }),
        ...(body.endDate && { endDate: new Date(body.endDate) }),
      },
    })
    return updated
  })

  // ─── POST /nutrition/sensation ────────────────────────────────────
  app.post('/nutrition/sensation', async (request, reply) => {
    const { id: athleteId } = request.user as { id: string }
    const body = nutritionSensationSchema.parse(request.body)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const sensation = await prisma.nutritionSensation.upsert({
      where: { athleteId_date: { athleteId, date: today } },
      update: body,
      create: { athleteId, date: today, ...body },
    })
    return reply.status(201).send(sensation)
  })
}
