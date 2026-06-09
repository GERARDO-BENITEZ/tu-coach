/**
 * Seed — carga datos de prueba realistas
 * Ejecutar: npm run db:seed
 */

import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding Tu Coach database...')

  // ─── 1. USUARIOS ────────────────────────────────────────────────
  const password = await bcrypt.hash('TuCoach2026!', 12)

  const coach = await prisma.user.upsert({
    where: { email: 'coach@tucoach.app' },
    update: {},
    create: {
      email: 'coach@tucoach.app',
      password,
      name: 'Coach Martínez',
      role: 'COACH',
    },
  })

  const nutritionist = await prisma.user.upsert({
    where: { email: 'nutricion@tucoach.app' },
    update: {},
    create: {
      email: 'nutricion@tucoach.app',
      password,
      name: 'Dra. Sofía Nutrición',
      role: 'NUTRITIONIST',
    },
  })

  // Atletas
  const athletes = await Promise.all([
    prisma.user.upsert({
      where: { email: 'gerardo@tucoach.app' },
      update: {},
      create: {
        email: 'gerardo@tucoach.app',
        password,
        name: 'Gerardo Benítez',
        role: 'ATHLETE',
      },
    }),
    prisma.user.upsert({
      where: { email: 'ana@tucoach.app' },
      update: {},
      create: {
        email: 'ana@tucoach.app',
        password,
        name: 'Ana López',
        role: 'ATHLETE',
      },
    }),
    prisma.user.upsert({
      where: { email: 'carlos@tucoach.app' },
      update: {},
      create: {
        email: 'carlos@tucoach.app',
        password,
        name: 'Carlos Ruiz',
        role: 'ATHLETE',
      },
    }),
  ])

  // ─── 2. PERFILES DE ATLETAS ───────────────────────────────────────
  await prisma.athleteProfile.upsert({
    where: { userId: athletes[0].id },
    update: {},
    create: {
      userId: athletes[0].id,
      sport: 'triathlon',
      ftp: 285,
      lthr: 158,
      maxHr: 185,
      vo2max: 58.2,
      weight: 72,
      height: 178,
    },
  })
  await prisma.athleteProfile.upsert({
    where: { userId: athletes[1].id },
    update: {},
    create: {
      userId: athletes[1].id,
      sport: 'running',
      lthr: 172,
      maxHr: 190,
      weight: 58,
      height: 165,
    },
  })
  await prisma.athleteProfile.upsert({
    where: { userId: athletes[2].id },
    update: {},
    create: {
      userId: athletes[2].id,
      sport: 'cycling',
      ftp: 310,
      lthr: 162,
      maxHr: 188,
      vo2max: 62.0,
      weight: 75,
      height: 175,
    },
  })

  // ─── 3. RELACIONES COACH ↔ ATLETA ────────────────────────────────
  await Promise.all(
    athletes.map(athlete =>
      prisma.coachAthlete.upsert({
        where: { coachId_athleteId: { coachId: coach.id, athleteId: athlete.id } },
        update: {},
        create: { coachId: coach.id, athleteId: athlete.id },
      })
    )
  )

  // ─── 4. ENTRENO DE HOY (Gerardo) ─────────────────────────────────
  const longRun = await prisma.workout.create({
    data: {
      coachId: coach.id,
      name: 'Long Run — Fondo Aeróbico Z2',
      type: 'endurance',
      sport: 'running',
      durationMin: 105,
      tssEstimated: 110,
      description: 'Carrera larga a ritmo aeróbico. Mantener FC en Z2 (130-145 bpm). Es el entreno más importante de la semana pre-competencia.',
      coachNote: '¡Gerardo, esta es tu última tirada larga antes del triatlón. Confía en el proceso, tienes la base para hacer una gran carrera el 28. 💪',
      segments: [
        { name: 'Calentamiento caminata', durationMin: 5, zone: 'Z1', repeat: 1 },
        { name: 'Carrera Z2 fácil', durationMin: 85, zone: 'Z2', pctFtp: null, repeat: 1 },
        { name: 'Progresivos finales', durationMin: 10, zone: 'Z3', repeat: 1 },
        { name: 'Enfriamiento + Core', durationMin: 20, zone: 'Z1', repeat: 1 },
      ],
    },
  })

  // Asignar a Gerardo hoy
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  await prisma.workoutAssignment.upsert({
    where: {
      workoutId_athleteId_date: {
        workoutId: longRun.id,
        athleteId: athletes[0].id,
        date: today,
      },
    },
    update: {},
    create: {
      workoutId: longRun.id,
      athleteId: athletes[0].id,
      date: today,
    },
  })

  // ─── 5. WELLNESS DE HOY (Gerardo) ────────────────────────────────
  await prisma.dailyWellness.upsert({
    where: { athleteId_date: { athleteId: athletes[0].id, date: today } },
    update: {},
    create: {
      athleteId: athletes[0].id,
      date: today,
      sleepQuality: 8,
      sleepHours: 7.5,
      stressLevel: 3,
      mood: 4,
      soreness: 3,
      motivation: 9,
      readyToTrain: true,
      hrv: 62,
      recoveryScore: 73,
      rhr: 42,
      bodyBattery: 78,
    },
  })

  // ─── 6. PLAN NUTRICIONAL ─────────────────────────────────────────
  // Desactivar planes anteriores
  await prisma.nutritionPlan.updateMany({
    where: { athleteId: athletes[0].id },
    data: { isActive: false },
  })

  await prisma.nutritionPlan.create({
    data: {
      nutritionistId: nutritionist.id,
      athleteId: athletes[0].id,
      name: 'Plan Triatlón 70.3 — Fase Peak',
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-06-28'),
      notes: 'Semana de competencia: aumentar carbohidratos el viernes y sábado. Hidratación mínima 3L/día.',
      days: {
        create: [
          // Domingo (hoy = día de entrenamiento largo)
          {
            dayOfWeek: 0,
            dayType: 'LONG',
            calories: 3200,
            carbsG: 420,
            proteinG: 155,
            fatG: 80,
            meals: [
              { name: 'Desayuno pre-entreno', time: '07:00', calories: 620, foods: [
                { name: 'Avena con plátano', amount: 80, unit: 'g', kcal: 340 },
                { name: 'Huevos revueltos', amount: 2, unit: 'pcs', kcal: 180 },
                { name: 'Café con leche', amount: 250, unit: 'ml', kcal: 100 },
              ]},
              { name: 'Gel durante entreno', time: '08:30', calories: 100, foods: [
                { name: 'Gel energético', amount: 1, unit: 'pcs', kcal: 100 },
              ]},
              { name: 'Recuperación post-entreno', time: '10:30', calories: 480, foods: [
                { name: 'Proteína whey + leche', amount: 300, unit: 'ml', kcal: 280 },
                { name: 'Plátano', amount: 1, unit: 'pcs', kcal: 100 },
                { name: 'Granola', amount: 30, unit: 'g', kcal: 100 },
              ]},
              { name: 'Comida', time: '14:00', calories: 850, foods: [
                { name: 'Pasta integral', amount: 120, unit: 'g', kcal: 420 },
                { name: 'Pollo a la plancha', amount: 200, unit: 'g', kcal: 280 },
                { name: 'Ensalada verde', amount: 150, unit: 'g', kcal: 50 },
                { name: 'Pan integral', amount: 1, unit: 'pcs', kcal: 100 },
              ]},
              { name: 'Snack', time: '17:00', calories: 280, foods: [
                { name: 'Yogur griego', amount: 200, unit: 'g', kcal: 180 },
                { name: 'Almendras', amount: 20, unit: 'g', kcal: 100 },
              ]},
              { name: 'Cena', time: '20:00', calories: 870, foods: [
                { name: 'Salmón al horno', amount: 200, unit: 'g', kcal: 440 },
                { name: 'Camote asado', amount: 200, unit: 'g', kcal: 230 },
                { name: 'Brócoli', amount: 200, unit: 'g', kcal: 70 },
                { name: 'Aceite de oliva', amount: 10, unit: 'ml', kcal: 90 },
              ]},
            ],
          },
          // Lunes (descanso)
          { dayOfWeek: 1, dayType: 'REST', calories: 2400, carbsG: 280, proteinG: 145, fatG: 85, meals: [] },
          // Martes
          { dayOfWeek: 2, dayType: 'TRAINING', calories: 2800, carbsG: 360, proteinG: 150, fatG: 78, meals: [] },
          // Miércoles
          { dayOfWeek: 3, dayType: 'TRAINING', calories: 2900, carbsG: 380, proteinG: 152, fatG: 79, meals: [] },
          // Jueves
          { dayOfWeek: 4, dayType: 'TRAINING', calories: 2750, carbsG: 350, proteinG: 148, fatG: 78, meals: [] },
          // Viernes (training)
          { dayOfWeek: 5, dayType: 'TRAINING', calories: 2650, carbsG: 330, proteinG: 148, fatG: 76, meals: [] },
          // Sábado (pre-long)
          { dayOfWeek: 6, dayType: 'LONG', calories: 3000, carbsG: 400, proteinG: 152, fatG: 79, meals: [] },
        ],
      },
    },
  })

  // ─── 7. PMC SNAPSHOT DE HOY ──────────────────────────────────────
  await prisma.pMCSnapshot.upsert({
    where: { athleteId_date: { athleteId: athletes[0].id, date: today } },
    update: {},
    create: {
      athleteId: athletes[0].id,
      date: today,
      ctl: 74.2,
      atl: 88.5,
      tsb: -14.3,
      dailyTss: 0,
    },
  })

  console.log('\n✅ Seed completado:')
  console.log(`  Coach:        ${coach.email}`)
  console.log(`  Nutriólogo:   ${nutritionist.email}`)
  console.log(`  Atletas:      ${athletes.map(a => a.email).join(', ')}`)
  console.log(`  Password:     TuCoach2026!\n`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
