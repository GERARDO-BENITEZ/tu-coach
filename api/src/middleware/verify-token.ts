import { FastifyRequest, FastifyReply } from 'fastify'

export interface JWTPayload {
  id: string
  email: string
  role: string
  name: string
}

declare module 'fastify' {
  interface FastifyRequest {
    user: JWTPayload
  }
}

export async function verifyToken(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    reply.status(401).send({ error: 'Token inválido o expirado' })
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await verifyToken(request, reply)
    const payload = request.user as JWTPayload
    if (!roles.includes(payload.role)) {
      reply.status(403).send({ error: 'Acceso no autorizado para este rol' })
    }
  }
}
