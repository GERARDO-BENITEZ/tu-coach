/**
 * Rutas del atleta — lo que el atleta ve cada día
 * GET /athlete/today          → entreno de hoy + wellness + nutrition
 * GET /athlete/calendar       → semana actual / por fecha
 * POST /athlete/wellness      → check-in matutino
 * POST /athlete/sensation     → sensación post-entreno
 * GET /athlete/pmc            → PMC de los últimos N días
 * GET /athlete/analytics      → stats aggregados
 */

import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { startOfWeek, endOfWeek, format, parseISO } from 'date-fns'
import { calculatePMC, formStatus, hrvAlert } from '../services/pmc'

const prisma = new PrismaClient()

const wellnessSchema = z.object({
  sleepQuality: z.number().int().min(0).max(10).optional(),
  sleepHours:   z.number().min(0).max(24).optional(),
  stressLevel:  z.number().int().min(0).max(10).optional(),
  mood:         z.number().int().min(1).max(5).optional(),
  soreness:     z.number().int().min(0).max(10).optional(),
  motivation:   z.number().int().min(0).max(10).optional(),
  readyToTrain: z.boolean().optional(),
})

const sensationSchema = z.object({
  assignmentId: z.string(),
  rpe:          z.number().int().min(1).max(10),
  feeling:      z.number().int().min(1).max(5),
  legsScore:    z.number().int().min(0).max(10),
  mentalScore:  z.number().int().min(0).max(10),
  energyScore:  z.number().int().min(0).max(10),
  painScore:    z.number().int().min(0).max(10).optional(),
  painLocation: z.string().optional(),
  note:         z.string().max(500).optional(),
})

export async function athleteRoutes(app: FastifyInstance) {

  // Middleware: solo atletas
  app.addHook('onRequest', app.authenticate)

  // ─── GET /athlete/today ─────────────────────────────────────────
  app.get('/athlete/today', async (request, reply) => {
    const { id: athleteId } = request.user as { id: string }
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Entrenos del día
    const assignments = await prisma.workoutAssignment.findMany({
      where: { athleteId, date: today },
      include: {
        workout: { include: { coach: { select: { name: true } } } },
        sensation: true,
      },
    })

    // Wellness de hoy
    const wellness = await prisma.dailyWellness.findUnique({
      where: { athleteId_date: { athleteId, date: today } },
    })

    // Plan nutricional activo
    const activePlan = await prisma.nutritionPlan.findFirst({
      where: {
        athleteId,
        isActive: true,
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: {
        days: { where: { dayOfWeek: today.getDay() } },
      },
    })

    // PMC snapshot de hoy
    const pmc = await prisma.pMCSnapshot.findUnique({
      where: { athleteId_date: { athleteId, date: today } },
    })

    // Alerta HRV si hay datos
    let alert = null
    if (wellness?.hrv) {
      const last30 = await prisma.dailyWellness.findMany({
        where: { athleteId, hrv: { not: null } },
        orderBy: { date: 'desc' },
        take: 30,
      })
      if (last30.length >= 7) {
        const hrvsArr = last30.map(d => d.hrv!)
        const mean = hrvsArr.reduce((s, v) => s + v, 0) / hrvsArr.length
        const sd = Math.sqrt(hrvsArr.map(v => (v - mean) ** 2).reduce((s, v) => s + v, 0) / hrvsArr.length)
        alert = hrvAlert(wellness.hrv, mean, sd)
      }
    }

    return {
      date: format(today, 'yyyy-MM-dd'),
      assignments,
      wellness,
      nutrition: activePlan?.days[0] ?? null,
      pmc: pmc ? { ...pmc, form: pmc ? formStatus(pmc.tsb) : null } : null,
      alert,
    }
  })

  // ─── GET /athlete/calendar?start=YYYY-MM-DD ─────────────────────
  app.get<{ Querystring: { start?: string } }>('/athlete/calendar', async (request) => {
    const { id: athleteId } = request.user as { id: string }
    const refDate = request.query.start ? parseISO(request.query.start) : new Date()
    const weekStart = startOfWeek(refDate, { weekStartsOn: 1 }) // Lunes
    const weekEnd   = endOfWeek(refDate,   { weekStartsOn: 1 }) // Domingo

    const assignments = await prisma.workoutAssignment.findMany({
      where: {
        athleteId,
        date: { gte: weekStart, lte: weekEnd },
      },
      include: {
        workout: true,
        sensation: true,
      },
      orderBy: { date: 'asc' },
    })

    // Wellness de la semana
    const wellnessWeek = await prisma.dailyWellness.findMany({
      where: {
        athleteId,
        date: { gte: weekStart, lte: weekEnd },
      },
    })

    return { weekStart, weekEnd, assignments, wellness: wellnessWeek }
  })

  // ─── POST /athlete/wellness ──────────────────────────────────────
  app.post('/athlete/wellness', async (request, reply) => {
    const { id: athleteId } = request.user as { id: string }
    const body = wellnessSchema.parse(request.body)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const wellness = await prisma.dailyWellness.upsert({
      where: { athleteId_date: { athleteId, date: today } },
      update: body,
      create: { athleteId, date: today, ...body },
    })

    return reply.status(201).send(wellness)
  })

  // ─── POST /athlete/sensation ─────────────────────────────────────
  app.post('/athlete/sensation', async (request, reply) => {
    const { id: athleteId } = request.user as { id: string }
    const body = sensationSchema.parse(request.body)

    // Verificar que el assignment pertenece al atleta
    const assignment = await prisma.workoutAssignment.findFirst({
      where: { id: body.assignmentId, athleteId },
    })
    if (!assignment) return reply.status(404).send({ error: 'Entreno no encontrado' })

    // Crear/actualizar sensación
    const sensation = await prisma.workoutSensation.upsert({
      where: { assignmentId: body.assignmentId },
      update: { ...body, athleteId },
      create: { ...body, athleteId },
    })

    // Marcar assignment como completado
    await prisma.workoutAssignment.update({
      where: { id: body.assignmentId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })

    return reply.status(201).send(sensation)
  })

  // ─── GET /athlete/pmc?days=90 ────────────────────────────────────
  app.get<{ Querystring: { days?: string } }>('/athlete/pmc', async (request) => {
    const { id: athleteId } = request.user as { id: string }
    const days = parseInt(request.query.days ?? '90')
    const since = new Date()
    since.setDate(since.getDate() - days)

    const snapshots = await prisma.pMCSnapshot.findMany({
      where: { athleteId, date: { gte: since } },
      orderBy: { date: 'asc' },
    })

    const latest = snapshots[snapshots.length - 1]
    return {
      data: snapshots,
      current: latest ? { ...latest, form: formStatus(latest.tsb) } : null,
    }
  })

  // ─── GET /athlete/analytics ──────────────────────────────────────
  app.get('/athlete/analytics', async (request) => {
    const { id: athleteId } = request.user as { id: string }
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [
      totalWorkouts,
      completedWorkouts,
      missedWorkouts,
      avgSensations,
    ] = await Promise.all([
      prisma.workoutAssignment.count({ where: { athleteId, date: { gte: thirtyDaysAgo } } }),
      prisma.workoutAssignment.count({ where: { athleteId, status: 'COMPLETED', date: { gte: thirtyDaysAgo } } }),
      prisma.workoutAssignment.count({ where: { athleteId, status: 'MISSED', date: { gte: thirtyDaysAgo } } }),
      prisma.workoutSensation.aggregate({
        where: { athleteId },
        _avg: { rpe: true, legsScore: true, mentalScore: true, energyScore: true },
      }),
    ])

    const compliance = totalWorkouts > 0 ? Math.round((completedWorkouts / totalWorkouts) * 100) : 0

    return {
      period: '30 días',
      compliance,
      totalWorkouts,
      completedWorkouts,
      missedWorkouts,
      averageSensations: avgSensations._avg,
    }
  })
}
