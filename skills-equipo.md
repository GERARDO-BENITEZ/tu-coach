# App Tu Coach — Skills del Equipo

> **Objetivo del Proyecto:** Desarrollar una aplicación para entrenadores al estilo TrainingPeaks, Strava, Garmin y Whoop, donde el coach pueda cargar planes de entrenamiento mensuales, semanales y diarios, y los atletas puedan visualizarlos de manera diaria y hacer seguimiento de su progreso.

---

## Vision General

Una plataforma integral de coaching deportivo que conecta entrenadores y atletas, permitiendo:
- Planificación y carga de entrenamientos (mensual / semanal / diario)
- Visualización clara y motivadora para el atleta
- Seguimiento de métricas de rendimiento y bienestar
- Comunicación directa entre coach y atleta
- Integración con dispositivos wearable

---

## Skills por Rol

---

### Diseñador de Páginas Web

**Core Skills**
- HTML5 semántico y accesibilidad (WCAG 2.1)
- CSS3 avanzado: Flexbox, Grid, animaciones, variables
- Responsive design y mobile-first
- Tipografía, jerarquía visual y espaciado
- Optimización de rendimiento web (Core Web Vitals)

**Herramientas**
- Figma / Adobe XD para mockups
- Tailwind CSS / Bootstrap
- Gestión de assets e imágenes optimizadas
- SEO técnico básico

**Aplicado al proyecto**
- Landing page del producto
- Páginas públicas de registro / login
- Dashboard del atleta (vista diaria de entrenamientos)
- Páginas de perfil y estadísticas

---

### Diseñador de Aplicaciones Móviles

**Core Skills**
- Principios de UX/UI para móvil (iOS y Android)
- Diseño de flujos de usuario (user flows) y wireframes
- Sistemas de diseño (design systems) y componentes reutilizables
- Micro-interacciones y animaciones nativas
- Prototyping interactivo

**Herramientas**
- Figma con plugins para móvil
- React Native / Flutter (colaboración con dev)
- Principios de Material Design y Human Interface Guidelines

**Aplicado al proyecto**
- App del atleta: ver entrenamiento del día, registrar completado
- App del coach: cargar y editar planes
- Notificaciones push de entrenamientos
- Visualización de métricas y gráficas de progreso

---

### Diseñador de Sistemas (System Designer)

**Core Skills**
- Arquitectura de software y diagramas (C4, UML)
- Diseño de APIs RESTful y GraphQL
- Modelado de bases de datos relacionales y no relacionales
- Escalabilidad, tolerancia a fallos y alta disponibilidad
- Patrones de diseño (MVC, Event-driven, Microservices)

**Herramientas**
- Draw.io / Lucidchart para diagramas
- Swagger / OpenAPI para documentación
- Docker y Kubernetes (conceptos)

**Aplicado al proyecto**
- Arquitectura de la plataforma coach-atleta
- Sistema de notificaciones en tiempo real
- Integración con APIs de Garmin, Strava, Whoop
- Sincronización de datos de entrenamiento

---

### Ingeniero de Datos

**Core Skills**
- Modelado de datos de entrenamiento deportivo
- ETL / pipelines de datos (ingesta, transformación, carga)
- Bases de datos: PostgreSQL, MongoDB, TimeSeries (InfluxDB)
- Análisis de métricas: frecuencia cardíaca, potencia, RPE, HRV
- Visualización de datos (charts, dashboards)

**Herramientas**
- Python (Pandas, NumPy)
- SQL avanzado
- Apache Kafka o similar para streams
- Grafana / Metabase para reportes

**Aplicado al proyecto**
- Almacenamiento de cargas de entrenamiento (TSS, CTL, ATL)
- Análisis de progresión del atleta
- Dashboard de métricas para el coach
- Integración de datos de wearables (Garmin, Whoop, Polar)

---

### Diseñador (UX/UI General)

**Core Skills**
- Investigación de usuario (user research, entrevistas, encuestas)
- Arquitectura de información y mapas de sitio
- Design Thinking y metodologías ágiles
- Pruebas de usabilidad (A/B testing, heatmaps)
- Identidad visual: paleta de colores, iconografía, branding

**Herramientas**
- Figma (principal), Adobe Illustrator
- Hotjar / Maze para testing
- Notion para documentar decisiones de diseño

**Aplicado al proyecto**
- Definir la identidad visual de "Tu Coach"
- Crear el design system completo
- Mapear el journey del atleta y del coach
- Iterar diseños basados en feedback real

---

### Coach Deportivo (Experto de Dominio)

**Core Skills**
- Periodización del entrenamiento (lineal, ondulada, por bloques)
- Métricas clave: TSS, CTL, ATL, TSB, FTP, RPE, HRV
- Deportes: trail running, ciclismo, triatlón, natación
- Nutrición deportiva básica y timing de comidas
- Comunicación efectiva con atletas amateur y elite

**Conocimiento aplicado al producto**
- Definir cómo se estructura un plan mensual / semanal / diario
- Tipos de sesiones: fuerza, cardio, recuperación, técnica
- Zonas de entrenamiento (potencia, frecuencia cardíaca, ritmo)
- Feedback post-entrenamiento: RPE, notas, sensaciones
- Qué métricas son más valiosas para mostrar en el dashboard

**Aplicado al proyecto**
- Validar el flujo de carga de entrenamientos del coach
- Definir los campos necesarios por sesión
- Priorizar qué ve el atleta cada mañana
- Diseñar la lógica de carga y tapering

---

### Profesional de Gestión / Producto (Product Manager)

**Core Skills**
- Definición de roadmap y priorización (MoSCoW, RICE)
- Gestión de backlog y sprints (Agile / Scrum)
- Definición de KPIs y métricas de producto
- Comunicación con stakeholders
- Análisis de competencia (TrainingPeaks, Strava, Final Surge)

**Herramientas**
- Linear / Jira para gestión de tareas
- Notion para documentación
- Analytics: Mixpanel, Amplitude

**Aplicado al proyecto**
- Definir MVP vs features futuras
- Gestionar el ciclo de desarrollo
- Priorizar entre necesidades del coach y del atleta
- Definir modelo de negocio (SaaS por coach)

---

### Nutriólogo Profesional

**Core Skills**
- Nutrición deportiva (macros, micros, timing)
- Planes de alimentación adaptados a carga de entrenamiento
- Hidratación y estrategias de recuperación
- Suplementación basada en evidencia
- Evaluación de composición corporal

**Conocimiento aplicado al producto**
- Integrar plan nutricional al plan de entrenamiento
- Recomendaciones pre/durante/post entrenamiento según sesión del día
- Tracking de ingesta calórica e hidratación
- Alertas de déficit calórico en días de alta carga
- Recetas y guías dentro de la app

**Aplicado al proyecto**
- Módulo de nutrición: el coach o nutriólogo asigna plan alimenticio
- El atleta ve qué comer según el entrenamiento del día
- Registro de alimentación y hidratación
- Reportes de cumplimiento nutricional al coach

---

## Stack Tecnológico Sugerido (MVP)

| Capa | Tecnología |
|------|-----------|
| Frontend Web | Next.js + Tailwind CSS |
| App Móvil | React Native (Expo) |
| Backend | Node.js + Express / Fastify |
| Base de datos | PostgreSQL + Redis (caché) |
| Autenticación | Supabase Auth / Auth0 |
| Almacenamiento | Supabase Storage / S3 |
| Notificaciones | Expo Push + OneSignal |
| Deploy | Vercel (web) + Railway (API) |
| Integración wearables | Garmin Connect IQ API, Strava API, Whoop API |

---

## Fases del Proyecto

### Fase 1 — MVP (3-4 meses)
- [ ] Auth: registro de coach y atleta
- [ ] Coach: crear y asignar plan semanal/diario
- [ ] Atleta: ver entrenamiento del día
- [ ] Atleta: marcar entrenamiento como completado + RPE
- [ ] Notificación diaria al atleta

### Fase 2 — Métricas (2-3 meses)
- [ ] Dashboard de progresión del atleta
- [ ] Gráficas de carga (CTL / ATL / TSB)
- [ ] Integración con Strava y Garmin
- [ ] Módulo de notas coach ↔ atleta

### Fase 3 — Nutrición e Integración (2-3 meses)
- [ ] Plan nutricional vinculado al plan de entrenamiento
- [ ] Integración Whoop (HRV, sueño, recovery)
- [ ] App móvil nativa (iOS y Android)
- [ ] Modelo de suscripción y pagos (Stripe)

---

> **Principio guía:** El atleta abre la app cada mañana y sabe exactamente qué hacer hoy — entrenar, comer y recuperarse.
