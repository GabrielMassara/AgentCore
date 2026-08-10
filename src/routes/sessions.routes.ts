import { FastifyInstance } from 'fastify';
import { createSession, getSession } from '../sessions/session-manager';

type CreateSessionBody = {
  runtime: 'claude';
  projectPath: string;
};

export default async function sessionRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateSessionBody }>('/v1/sessions', async (request, reply) => {
    const { runtime, projectPath } = request.body;

    if (!runtime || !projectPath) {
      return reply.code(400).send({ error: '"runtime" and "projectPath" are required' });
    }

    if (runtime !== 'claude') {
      return reply.code(400).send({ error: `Unsupported runtime: "${runtime}"` });
    }

    const session = createSession(runtime, projectPath);
    return reply.code(201).send(session);
  });

  app.get<{ Params: { sessionId: string } }>('/v1/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;
    const session = getSession(sessionId);

    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    return reply.send(session);
  });
}
