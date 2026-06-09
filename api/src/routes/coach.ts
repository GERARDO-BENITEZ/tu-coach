/**
 * Rutas del coach — gestión de atletas, planes y entrenos
 * GET  /coach/athletes            → roster de atletas con stats
 * POST /coach/workouts            → crear entreno
 * POST /coach/workouts/:id/assign → asignar entreno a atleta + fecha
 * GET  /coach/team/today          → vista del equipo hoy
 * GET  /coach/team/sensations     → sensaciones del equipo
 * PUT  /coach/assignments/:id     → modificar asignación (ajustar plan)
 */

import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { startOfWeek, endOfWeek, parseISO } from 'date-fns'
import { formStatus } from '../services/pmc'

const prisma = new PrismaClient()

const workoutSchema = z.object({
  name:         z.string().min(1),
  type:         z.enum(['intervals', 'endurance', 'recovery', 'strength', 'race', 'tempo']),
  sport:        z.enum(['cycling', 'running', 'swimming', 'strength', 'cross']),
  durationMin:  z.number().int().min(1),
  tssEstimated: z.number().int().optional(),
  description:  z.string().optional(),
  coachNote:    z.string().optional(),
  segments:     z.array(z.object({
    name:        z.string(),
    durationMin: z.number(),
    zone:        z.string(),
    pctFtp:      z.number().optional(),
    repeat:      z.number().int().default(1),
  })),
  planId:       z.string().optional(),
})

const assignSchema = z.object({
  athleteId: z.string(),
  date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const bulkAssignSchema = z.object({
  assignments: z.array(z.object({
    athleteId: z.string(),
    date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })),
})

export async function coachRoutes(app: FastifyInstance) {

  app.addHook('onRequest', app.authenticate)

  // ─── GET /coach/athletes ─────────────────────────────────────────
  app.get('/coach/athletes', async (request) => {
    const { id: coachId } = request.user as { id: string }

    const relations = await prisma.coachAthlete.findMany({
      where: { coachId, isActive: true },
      include: {
        athlete: {
          include: {
            profile: true,
            pmcSnapshots: { orderBy: { date: 'desc' }, take: 1 },
            dailyWellness: { orderBy: { date: 'desc' }, take: 1 },
          },
        },
      },
    })

    return relations.map(r => {
      const pmc = r.athlete.pmcSnapshots[0]
      const wellness = r.athlete.dailyWellness[0]
      return {
        id: r.athlete.id,
        name: r.athlete.name,
        email: r.athlete.email,
        avatar: r.athlete.avatar,
        sport: r.athlete.profile?.sport,
        ftp: r.athlete.profile?.ftp,
        pmc: pmc ? { ctl: pmc.ctl, atl: pmc.atl, tsb: pmc.tsb, form: formStatus(pmc.tsb) } : null,
        wellness: wellness ? {
          hrv: wellness.hrv,
          recoveryScore: wellness.recoveryScore,
          rhr: wellness.rhr,
          readyToTrain: wellness.readyToTrain,
        } : null,
      }
    })
  })

  // ─── POST /coach/workouts ─────────────────────────────────────────
  app.post('/coach/workouts', async (request, reply) => {
    const { id: coachId } = request.user as { id: string }
    const body = workoutSchema.parse(request.body)

    const workout = await prisma.workout.create({
      data: { ...body, coachId },
    })
    return reply.status(201).send(workout)
  })

  // ─── GET /coach/workouts ──────────────────────────────────────────
  app.get('/coach/workouts', async (request) => {
    const { id: coachId } = request.user as { id: string }
    return prisma.workout.findMany({
      where: { coachId },
      orderBy: { createdAt: 'desc' },
    })
  })

  // ─── POST /coach/workouts/:id/assign ─────────────────────────────
  app.post<{ Params: { id: string } }>('/coach/workouts/:id/assign', async (request, reply) => {
    const { id: coachId } = request.user as { id: string }
    const { id: workoutId } = request.params

    // Verificar que el workout pertenece al coach
    const workout = await prisma.workout.findFirst({ where: { id: workoutId, coachId } })
    if (!workout) return reply.status(404).send({ error: 'Entreno no encontrado' })

    const body = assignSchema.parse(request.body)

    // Verificar que el atleta pertenece al coach
    const rel = await prisma.coachAthlete.findFirst({
      where: { coachId, athleteId: body.athleteId, isActive: true },
    })
    if (!rel) return reply.status(403).send({ error: 'Atleta no pertenece a tu equipo' })

    const assignment = await prisma.workoutAssignment.upsert({
      where: {
        workoutId_athleteId_date: {
          workoutId,
          athleteId: body.athleteId,
          date: new Date(body.date),
        },
      },
      update: { status: 'PENDING' },
      create: {
        workoutId,
        athleteId: body.athleteId,
        date: new Date(body.date),
      },
    })
    return reply.status(201).send(assignment)
  })

  // ─── POST /coach/workouts/:id/assign-bulk ────────────────────────
  app.post<{ Params: { id: string } }>('/coach/workouts/:id/assign-bulk', async (request, reply) => {
    const { id: coachId } = request.user as { id: string }
    const { id: workoutId } = request.params
    const workout = await prisma.workout.findFirst({ where: { id: workoutId, coachId } })
    if (!workout) return reply.status(404).send({ error: 'Entreno no encontrado' })

    const { assignments } = bulkAssignSchema.parse(request.body)
    const created = await Promise.all(
      assignments.map(a =>
        prisma.workoutAssignment.upsert({
          where: { workoutId_athleteId_date: { workoutId, athleteId: a.athleteId, date: new Date(a.date) } },
          update: { status: 'PENDING' },
          create: { workoutId, athleteId: a.athleteId, date: new Date(a.date) },
        })
      )
    )
    return reply.status(201).send({ assigned: created.length, assignments: created })
  })

  // ─── GET /coach/team/today ────────────────────────────────────────
  app.get('/coach/team/today', async (request) => {
    const { id: coachId } = request.user as { id: string }
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const athletes = await prisma.coachAthlete.findMany({
      where: { coachId, isActive: true },
      select: { athleteId: true },
    })
    const athleteIds = athletes.map(a => a.athleteId)

    const [assignments, wellness] = await Promise.all([
      prisma.workoutAssignment.findMany({
        where: { athleteId: { in: athleteIds }, date: today },
        include: {
          athlete: { select: { id: true, name: true, avatar: true } },
          workout: { select: { name: true, sport: true, type: true, durationMin: true, tssEstimated: true } },
          sensation: true,
        },
      }),
      prisma.dailyWellness.findMany({
        where: { athleteId: { in: athleteIds }, date: today },
        include: { athlete: { select: { id: true, name: true } } },
      }),
    ])

    return { date: today, assignments, wellness }
  })

  // ─── GET /coach/team/sensations ───────────────────────────────────
  app.get<{ Querystring: { week?: string } }>('/coach/team/sensations', async (request) => {
    const { id: coachId } = request.user as { id: string }
    const refDate = request.query.week ? parseISO(request.query.week) : new Date()
    const weekStart = startOfWeek(refDate, { weekStartsOn: 1 })
    const weekEnd   = endOfWeek(refDate,   { weekStartsOn: 1 })

    const athletes = await prisma.coachAthlete.findMany({
      where: { coachId, isActive: true },
      select: { athleteId: true },
    })
    const athleteIds = athletes.map(a => a.athleteId)

    const sensations = await prisma.workoutSensation.findMany({
      where: {
        athleteId: { in: athleteIds },
        createdAt: { gte: weekStart, lte: weekEnd },
      },
      include: {
        athlete: { select: { id: true, name: true, avatar: true } },
        assignment: {
          include: { workout: { select: { name: true, sport: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return sensations
  })

  // ─── PUT /coach/assignments/:id ───────────────────────────────────
  app.put<{ Params: { id: string } }>('/coach/assignments/:id', async (request, reply) => {
    const { id: coachId } = request.user as { id: string }
    const { id: assignmentId } = request.params
    const body = z.object({
      status: z.enum(['PENDING', 'MODIFIED', 'SKIPPED']).optional(),
      modifiedNote: z.string().optional(),
      date: z.string().optional(),
    }).parse(request.body)

    // Verificar que el assignment es de un atleta del coach
    const assignment = await prisma.workoutAssignment.findFirst({
      where: { id: assignmentId },
      include: { athlete: { include: { athleteCoaches: { where: { coachId } } } } },
    })
    if (!assignment || assignment.athlete.athleteCoaches.length === 0) {
      return reply.status(403).send({ error: 'Sin acceso a este assignment' })
    }

    const updated = await prisma.workoutAssignment.update({
      where: { id: assignmentId },
      data: {
        ...(body.status && { status: body.status }),
        ...(body.modifiedNote && { modifiedNote: body.modifiedNote }),
        ...(body.date && { date: new Date(body.date) }),
      },
    })
    return updated
  })

  // ─── GET /coach/team/compliance?weeks=8 ──────────────────────────
  app.get<{ Querystring: { weeks?: string } }>('/coach/team/compliance', async (request) => {
    const { id: coachId } = request.user as { id: string }
    const weeks = parseInt(request.query.weeks ?? '8')
    const since = new Date()
    since.setDate(since.getDate() - weeks * 7)

    const athletes = await prisma.coachAthlete.findMany({
      where: { coachId, isActive: true },
      include: { athlete: { select: { id: true, name: true } } },
    })

    const complianceData = await Promise.all(
      athletes.map(async ({ athlete }) => {
        const total = await prisma.workoutAssignment.count({
          where: { athleteId: athlete.id, date: { gte: since } },
        })
        const completed = await prisma.workoutAssignment.count({
          where: { athleteId: athlete.id, status: 'COMPLETED', date: { gte: since } },
        })
        return {
          athlete,
          compliance: total > 0 ? Math.round((completed / total) * 100) : 0,
          total,
          completed,
        }
      })
    )

    return complianceData
  })
}
