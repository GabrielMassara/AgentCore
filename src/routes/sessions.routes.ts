import { FastifyInstance } from 'fastify';
import { createSession, getSession } from '../sessions/session-manager';
import { ClaudeRuntime } from '../runtimes/claude/claude.runtime';
import { subscribe, unsubscribe } from '../events/event-bus';
import { AgentEvent } from '../events/agent-event';

type CreateSessionBody = {
  runtime: 'claude';
  projectPath: string;
};

type SendMessageBody = {
  content: string;
};

// Instância única do runtime, compartilhada por todas as requisições.
// O controle de qual sessão está rodando fica dentro do próprio ClaudeRuntime
const claudeRuntime = new ClaudeRuntime();

export default async function sessionRoutes(app: FastifyInstance) {
  // Cria uma sessão nova apenas registro interno
  app.post<{ Body: CreateSessionBody }>('/v1/sessions', async (request, reply) => {
    const { runtime, projectPath } = request.body;

    // Os dois campos são obrigatórios para criar a sessão.
    if (!runtime || !projectPath) {
      return reply.code(400).send({ error: '"runtime" and "projectPath" are required' });
    }

    // Por enquanto só existe suporte ao runtime do claude, mas depois vou fazer para outros
    if (runtime !== 'claude') {
      return reply.code(400).send({ error: `Unsupported runtime: "${runtime}"` });
    }

    const session = createSession(runtime, projectPath);
    return reply.code(201).send(session);
  });

  // Consulta o estado atual de uma sessão (status, providerSessionId, etc).
  app.get<{ Params: { sessionId: string } }>('/v1/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;
    const session = getSession(sessionId);

    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    return reply.send(session);
  });

  // Envia uma mensagem para o Claude dentro de uma sessão existente.
  app.post<{ Params: { sessionId: string }; Body: SendMessageBody }>(
    '/v1/sessions/:sessionId/messages',
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = getSession(sessionId);

      // Sessão precisa existir antes de qualquer outra validação.
      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      // Lê o content do corpo da requisicao
      const body = request.body;
      let content = '';

      if (body && body.content) {
        content = body.content;
      }

      if (!content || typeof content !== 'string') {
        return reply.code(400).send({ error: '"content" is required' });
      }

      // Uma sessão só pode processar uma mensagem por vez.
      // Se já está rodando ou esperando permissão, rejeita com 409
      if (session.status === 'running') {
        return reply.code(409).send({ error: `Session is busy (status: "${session.status}")` });
      }

      if (session.status === 'waiting_permission') {
        return reply.code(409).send({ error: `Session is busy (status: "${session.status}")` });
      }

      // Loga qualquer erro que aconteça durante a execução do Claude em background.
      function handleSendMessageError(err: unknown) {
        request.log.error(err, 'ClaudeRuntime.sendMessage failed');
      }

      // A chamada ao Claude vai roda em background
      // O cliente HTTP vai receber a resposta 202 imediatamente sem esperar o Claude terminar
      claudeRuntime.sendMessage(session, content).catch(handleSendMessageError);

      return reply.code(202).send({ accepted: true });
    }
  );

  // Conexão SSE (Server-Sent Events) para acompanhar a execução em tempo real.
  app.get<{ Params: { sessionId: string } }>(
    '/v1/sessions/:sessionId/events',
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = getSession(sessionId);

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      // A partir daqui a resposta é controlada manualmente usando reply.raw, então
      // uso o reply.hijack() para que o fastify não tente enviar uma resposta normal sozinho
      reply.hijack();

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      // Envia um AgentEvent para o cliente conectado no formato que o SSE espera
      function sendEvent(event: AgentEvent) {
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      subscribe(sessionId, sendEvent);

      // Quando o cliente desconecta, para de escutar e libera o listener
      request.raw.on('close', function handleClientDisconnect() {
        unsubscribe(sessionId, sendEvent);
        reply.raw.end();
      });
    }
  );

  // Cancela a execução em andamento de uma sessão.
  app.post<{ Params: { sessionId: string } }>(
    '/v1/sessions/:sessionId/cancel',
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = getSession(sessionId);

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      // Só existe execução para cancelar se a sessão estiver "running".
      if (session.status !== 'running') {
        return reply.code(409).send({ error: `Session has no execution to cancel (status: "${session.status}")` });
      }

      // Só sinaliza o cancelamento aqui. depois o catch de sendMessage sinaliza de fato quando a execução realmente parar.
      await claudeRuntime.cancel(sessionId);

      return reply.code(200).send({ cancelled: true });
    }
  );
}
