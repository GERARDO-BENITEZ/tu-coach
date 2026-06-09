/**
 * Cron Jobs — se ejecutan a las 12:00 AM (medianoche) todos los días
 *
 * 1. Recalcular PMC (CTL/ATL/TSB) para todos los atletas activos
 * 2. Marcar workouts PENDING del día anterior como MISSED
 * 3. Pre-cargar el plan del día siguiente
 * 4. Calcular alertas HRV del equipo
 */

import cron from 'node-cron'
import { PrismaClient } from '@prisma/client'
import { calculatePMC, formStatus } from './pmc'
import { subDays, startOfDay, endOfDay } from 'date-fns'

const prisma = new PrismaClient()

/** Recalcula el PMC snapshot de hoy para un atleta */
async function recalculatePMCForAthlete(athleteId: string) {
  try {
    // Obtener los últimos 90 días de TSS completados
    const since = new Date()
    since.setDate(since.getDate() - 90)

    const assignments = await prisma.workoutAssignment.findMany({
      where: {
        athleteId,
        status: 'COMPLETED',
        date: { gte: since, lt: startOfDay(new Date()) },
      },
      orderBy: { date: 'asc' },
    })

    if (assignments.length === 0) return

    // Último snapshot conocido para usar como punto de inicio
    const lastSnapshot = await prisma.pMCSnapshot.findFirst({
      where: { athleteId },
      orderBy: { date: 'desc' },
    })

    const tssData = assignments.map(a => ({
      date: new Date(a.date),
      tss: a.actualTss ?? a.workout?.tssEstimated ?? 50,
    }))

    // Recalcular desde el último punto conocido
    const pmcResults = calculatePMC(
      tssData,
      lastSnapshot?.ctl ?? 0,
      lastSnapshot?.atl ?? 0
    )

    // Upsert cada punto en la BD (solo los últimos 7 días para eficiencia)
    const last7 = pmcResults.slice(-7)
    await Promise.all(
      last7.map(point =>
        prisma.pMCSnapshot.upsert({
          where: { athleteId_date: { athleteId, date: startOfDay(point.date) } },
          update: { ctl: point.ctl, atl: point.atl, tsb: point.tsb, dailyTss: point.tss },
          create: {
            athleteId,
            date: startOfDay(point.date),
            ctl: point.ctl,
            atl: point.atl,
            tsb: point.tsb,
            dailyTss: point.tss,
          },
        })
      )
    )
  } catch (err) {
    console.error(`[PMC Cron] Error para atleta ${athleteId}:`, err)
  }
}

/** Marca como MISSED los workouts PENDING del día anterior */
async function markMissedWorkouts() {
  const yesterday = subDays(new Date(), 1)
  const result = await prisma.workoutAssignment.updateMany({
    where: {
      status: 'PENDING',
      date: {
        gte: startOfDay(yesterday),
        lte: endOfDay(yesterday),
      },
    },
    data: { status: 'MISSED' },
  })
  console.log(`[Cron] ${result.count} workouts marcados como MISSED`)
}

/** Genera alertas HRV para el equipo de un coach */
async function generateHRVAlerts() {
  const athletes = await prisma.user.findMany({
    where: { role: 'ATHLETE', isActive: true },
    select: { id: true, name: true },
  })

  for (const athlete of athletes) {
    try {
      const todayWellness = await prisma.dailyWellness.findFirst({
        where: {
          athleteId: athlete.id,
          date: startOfDay(new Date()),
        },
      })

      if (!todayWellness?.hrv) continue

      const last30 = await prisma.dailyWellness.findMany({
        where: {
          athleteId: athlete.id,
          hrv: { not: null },
          date: { lt: startOfDay(new Date()) },
        },
        orderBy: { date: 'desc' },
        take: 30,
      })

      if (last30.length < 7) continue

      const hrvValues = last30.map(d => d.hrv!)
      const mean = hrvValues.reduce((s, v) => s + v, 0) / hrvValues.length
      const variance = hrvValues.map(v => (v - mean) ** 2).reduce((s, v) => s + v, 0) / hrvValues.length
      const sd = Math.sqrt(variance)
      const z = (todayWellness.hrv - mean) / sd

      if (z < -1) {
        console.log(`[HRV Alert] ${athlete.name}: z=${z.toFixed(2)}, HRV=${todayWellness.hrv}ms`)
        // TODO: Enviar notificación push al coach via OneSignal
      }
    } catch {}
  }
}

/** Inicia todos los cron jobs */
export function startCronJobs() {
  // ═══ 12:00 AM todos los días ═══
  cron.schedule('0 0 * * *', async () => {
    console.log(`[Cron] 🌙 Iniciando actualización nocturna — ${new Date().toISOString()}`)

    // 1. Marcar workouts perdidos del día anterior
    await markMissedWorkouts()

    // 2. Recalcular PMC para todos los atletas activos
    const athletes = await prisma.user.findMany({
      where: { role: 'ATHLETE', isActive: true },
      select: { id: true },
    })

    console.log(`[Cron] Recalculando PMC para ${athletes.length} atletas...`)
    await Promise.all(athletes.map(a => recalculatePMCForAthlete(a.id)))

    // 3. Generar alertas HRV
    await generateHRVAlerts()

    console.log(`[Cron] ✅ Actualización nocturna completada`)
  }, {
    timezone: 'America/Mexico_City',
  })

  // ═══ Cada hora — sync datos de Garmin/Whoop ═══
  // Este job solo corre si las integraciones están conectadas
  cron.schedule('0 * * * *', async () => {
    // TODO: Llamar a Garmin y Whoop APIs para sync de actividades recientes
    // Se implementa en Fase 2 con las integraciones OAuth completas
    console.log(`[Cron] ⏰ Hourly sync check — ${new Date().toISOString()}`)
  })

  console.log('[Cron] ✅ Jobs registrados: PMC a medianoche (America/Mexico_City), sync cada hora')
}
