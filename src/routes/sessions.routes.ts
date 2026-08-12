import { FastifyInstance } from 'fastify';
import { getSessionMessages, deleteSession as deleteProviderSession, forkSession, tagSession as tagProviderSession, type SDKMessage, type PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { createSession, getSession, listSessions, deleteSession, renameSession, tagSession, updateSession } from '../sessions/session-manager';
import { ClaudeRuntime } from '../runtimes/claude/claude.runtime';
import { ClaudeEventMapper } from '../runtimes/claude/claude.mapper';
import { CodexRuntime } from '../runtimes/codex/codex.runtime';
import { readCodexHistory } from '../runtimes/codex/codex.history';
import { AgentRuntime } from '../runtimes/agent-runtime';
import { subscribe, unsubscribe } from '../events/event-bus';
import { AgentEvent } from '../events/agent-event';
import { AgentSession, SessionStatus, CodexSandboxMode } from '../sessions/session';

type CreateSessionBody = {
  runtime: 'claude' | 'codex';
  projectPath: string;
};

type ListSessionsQuery = {
  status?: string;
  limit?: string;
  offset?: string;
};

const validStatuses: SessionStatus[] = [
  'ready',
  'running',
  'waiting_permission',
  'completed',
  'cancelled',
  'error',
];

type SessionHistoryQuery = {
  limit?: string;
  offset?: string;
};

type SendMessageBody = {
  content: string;
};

type RenameSessionBody = {
  title: string;
};

type ForkSessionBody = {
  upToMessageId?: string;
};

type TagSessionBody = {
  tag: string | null;
};

type RejectPermissionBody = {
  reason?: string;
};

type SetPermissionModeBody = {
  mode: PermissionMode;
};

const validPermissionModes: PermissionMode[] = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
];

type SetCodexSandboxModeBody = {
  mode: CodexSandboxMode;
};

const validCodexSandboxModes: CodexSandboxMode[] = [
  'read-only',
  'workspace-write',
  'danger-full-access',
];

type SetModelBody = {
  model: string | null;
};

type RewindFilesBody = {
  userMessageId: string;
  dryRun?: boolean;
};

// Mesma regra do server.ts em que o CORS é liberado só em desenvolvimento.
const isDev = process.env.NODE_ENV !== 'production';

// Instância única de cada runtime, compartilhada por todas as requisições.
// O controle de qual sessão está rodando fica dentro do próprio runtime.
const claudeRuntime = new ClaudeRuntime();
const codexRuntime = new CodexRuntime();

// Escolhe a instância de runtime certa para uma sessão de acordo com o campo AgentSession.runtime.
function runtimeFor(session: AgentSession): AgentRuntime {
  return session.runtime === 'codex' ? codexRuntime : claudeRuntime;
}

export default async function sessionRoutes(app: FastifyInstance) {
  // Cria uma sessão nova apenas registro interno
  app.post<{ Body: CreateSessionBody }>('/v1/sessions', async (request, reply) => {
    const { runtime, projectPath } = request.body;

    // Os dois campos são obrigatórios para criar a sessão.
    if (!runtime || !projectPath) {
      return reply.code(400).send({ error: '"runtime" and "projectPath" are required' });
    }

    if (runtime !== 'claude' && runtime !== 'codex') {
      return reply.code(400).send({ error: `Unsupported runtime: "${runtime}"` });
    }

    const session = createSession(runtime, projectPath);
    return reply.code(201).send(session);
  });

  // Lista as sessões conhecidas, com filtro opcional por status e paginação.
  app.get<{ Querystring: ListSessionsQuery }>('/v1/sessions', async (request, reply) => {
    const { status, limit, offset } = request.query;

    if (status && !validStatuses.includes(status as SessionStatus)) {
      return reply.code(400).send({ error: `Invalid status: "${status}"` });
    }

    let parsedLimit = 20;
    if (limit !== undefined) {
      parsedLimit = Number(limit);

      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
        return reply.code(400).send({ error: '"limit" must be a positive integer' });
      }
    }

    let parsedOffset = 0;
    if (offset !== undefined) {
      parsedOffset = Number(offset);

      if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
        return reply.code(400).send({ error: '"offset" must be a non-negative integer' });
      }
    }

    const allSessions = listSessions(status ? { status: status as SessionStatus } : undefined);
    const page = allSessions.slice(parsedOffset, parsedOffset + parsedLimit);

    return reply.send({
      sessions: page,
      total: allSessions.length,
      limit: parsedLimit,
      offset: parsedOffset,
    });
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

  // Renomeia uma sessão, alterando apenas o título exibido.
  app.patch<{ Params: { sessionId: string }; Body: RenameSessionBody }>(
    '/v1/sessions/:sessionId',
    async (request, reply) => {
      const { sessionId } = request.params;

      if (!getSession(sessionId)) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      const title = request.body && request.body.title;

      if (!title || typeof title !== 'string' || !title.trim()) {
        return reply.code(400).send({ error: '"title" is required' });
      }

      const updated = renameSession(sessionId, title.trim());

      return reply.send(updated);
    }
  );

  // Recupera o histórico de mensagens de uma conversa direto do armazenamento local da SDK
  app.get<{ Params: { sessionId: string }; Querystring: SessionHistoryQuery }>(
    '/v1/sessions/:sessionId/history',
    async (request, reply) => {
      const { sessionId } = request.params;
      const { limit, offset } = request.query;

      const session = getSession(sessionId);

      // Se a sessão é conhecida localmente mas nunca chegou a falar com o Claude nao tem como pegar
      if (session && !session.providerSessionId) {
        return reply.code(404).send({ error: 'Session has no history yet' });
      }

      let parsedLimit: number | undefined;
      let parsedOffset: number | undefined;

      if (limit !== undefined) {
        parsedLimit = Number(limit);

        if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
          return reply.code(400).send({ error: '"limit" must be a positive integer' });
        }
      }

      if (offset !== undefined) {
        parsedOffset = Number(offset);

        if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
          return reply.code(400).send({ error: '"offset" must be a non-negative integer' });
        }
      }

      // O Codex não guarda a conversa no mesmo lugar que o Claude
      if (session && session.runtime === 'codex') {
        const events = readCodexHistory(sessionId, session.providerSessionId!);

        if (!events.length) {
          return reply.code(404).send({ error: 'Session not found' });
        }

        const start = parsedOffset ?? 0;
        const end = parsedLimit !== undefined ? start + parsedLimit : undefined;

        return reply.send({ events: events.slice(start, end) });
      }

      // Se o registro local existe, usa o providerSessionId dele. Senão, trata o próprio :sessionId como sendo o providerSessionId
      const providerSessionId = session ? session.providerSessionId! : sessionId;

      const options: { limit?: number; offset?: number; dir?: string } = {};

      // Passa "dir" quando dá pra evitar o fallback pouco confiável da SDK de vasculhar todos os projetos.
      if (session) {
        options.dir = session.projectPath;
      }

      if (parsedLimit !== undefined) {
        options.limit = parsedLimit;
      }

      if (parsedOffset !== undefined) {
        options.offset = parsedOffset;
      }

      const messages = await getSessionMessages(providerSessionId, options);

      if (!messages.length) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      // Reaproveita o mesmo mapper usado no fluxo ao vivo, para que o histórico chegue ao cliente no mesmo formato de AgentEvent usado no SSE.
      const eventMapper = new ClaudeEventMapper(sessionId);
      const events: AgentEvent[] = [];

      for (const message of messages) {
        events.push(...eventMapper.map(message as unknown as SDKMessage));
      }

      return reply.send({ events });
    }
  );

  // Uso acumulado de tokens/custo da sessão, extraído das mensagens "result" da SDK.
  app.get<{ Params: { sessionId: string } }>(
    '/v1/sessions/:sessionId/usage',
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = getSession(sessionId);

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      return reply.send(
        session.usage ?? {
          totalCostUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          modelUsage: {},
        }
      );
    }
  );

  // Remove uma sessão: registro local e a conversa correspondente do lado do provedor
  app.delete<{ Params: { sessionId: string } }>(
    '/v1/sessions/:sessionId',
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = getSession(sessionId);

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      // Apagar uma sessão em execução deixaria o AbortController que a rastreia órfão.
      if (session.status === 'running' || session.status === 'waiting_permission') {
        return reply.code(409).send({ error: `Cannot delete session while it is busy (status: "${session.status}")` });
      }

      // Se a sessão nunca chegou a falar com o agente não há conversa do lado do provedor para apagar.
      if (session.providerSessionId) {
        try {
          await deleteProviderSession(session.providerSessionId);
        } catch (err) {
          request.log.warn(err, 'deleteSession: failed to delete provider-side conversation');
        }
      }

      deleteSession(sessionId);

      return reply.code(200).send({ deleted: true });
    }
  );

  // Ramifica a conversa de uma sessão em uma nova sessão independente, sem afetar a original.
  app.post<{ Params: { sessionId: string }; Body: ForkSessionBody }>(
    '/v1/sessions/:sessionId/fork',
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = getSession(sessionId);

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      // Só existe conversa do lado do provedor pra ramificar depois da primeira mensagem.
      if (!session.providerSessionId) {
        return reply.code(409).send({ error: 'Session has no conversation to fork yet' });
      }

      // Se vier um upToMessageId, a ramificação corta a transcrição exatamente nessa mensagem, mensagens posteriores da conversa original não entram na cópia
      const upToMessageId = request.body && request.body.upToMessageId;
      const forkOptions = upToMessageId ? { upToMessageId } : undefined;

      let forkResult;

      try {
        forkResult = await forkSession(session.providerSessionId, forkOptions);
      } catch (err) {
        request.log.error(err, 'forkSession: failed to fork provider-side conversation');
        return reply.code(502).send({ error: 'Failed to fork session' });
      }

      let forked = createSession(session.runtime, session.projectPath, forkResult.sessionId, session.id, upToMessageId);

      // Propaga um título distinto para a ramificação ficar reconhecível na lista de sessões.
      if (session.title) {
        forked = renameSession(forked.id, `${session.title} (fork)`) ?? forked;
      }

      return reply.code(201).send(forked);
    }
  );

  // Marca uma tag na sessão.
  app.post<{ Params: { sessionId: string }; Body: TagSessionBody }>(
    '/v1/sessions/:sessionId/tag',
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = getSession(sessionId);

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      const body = request.body;

      if (!body || !('tag' in body)) {
        return reply.code(400).send({ error: '"tag" is required (use null to clear)' });
      }

      let tag = body.tag;

      if (typeof tag === 'string') {
        tag = tag.trim() || null;
      } else if (tag !== null) {
        return reply.code(400).send({ error: '"tag" must be a string or null' });
      }

      // Espelha a tag do lado do provedor quando já existe uma conversa pra marcar.
      // Só existe pro Claude, a Codex SDK não expõe nada equivalente
      if (session.runtime === 'claude' && session.providerSessionId) {
        try {
          await tagProviderSession(session.providerSessionId, tag);
        } catch (err) {
          request.log.warn(err, 'tagSession: failed to tag provider-side conversation');
        }
      }

      const updated = tagSession(sessionId, tag);

      return reply.send(updated);
    }
  );

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

      // Loga qualquer erro que aconteça durante a execução do agente em background.
      function handleSendMessageError(err: unknown) {
        request.log.error(err, 'AgentRuntime.sendMessage failed');
      }

      // A chamada ao agente roda em background.
      // O cliente HTTP vai receber a resposta 202 imediatamente sem esperar o agente terminar
      runtimeFor(session).sendMessage(session, content).catch(handleSendMessageError);

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
      // uso o reply.hijack() para que o fastify não tente enviar uma resposta normal sozinho.
      reply.hijack();

      const sseHeaders: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      };

      const origin = request.headers.origin;

      if (isDev && origin) {
        sseHeaders['Access-Control-Allow-Origin'] = origin;
        sseHeaders['Vary'] = 'Origin';
      }

      reply.raw.writeHead(200, sseHeaders);

      // Sem isso, o Node só manda os headers junto do primeiro write()
      reply.raw.flushHeaders();

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
      await runtimeFor(session).cancel(sessionId);

      return reply.code(200).send({ cancelled: true });
    }
  );

  // Configura o permission mode de uma sessão. Sempre grava como o padrão usado na próxima
  // query() (options.permissionMode) se já existe uma execução em andamento, aplica na hora
  app.post<{ Params: { sessionId: string }; Body: SetPermissionModeBody }>(
    '/v1/sessions/:sessionId/permission-mode',
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = getSession(sessionId);

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      // permissionMode é um conceito apenas do Claude
      if (session.runtime !== 'claude') {
        return reply.code(400).send({ error: 'permission-mode only applies to Claude sessions' });
      }

      const mode = request.body && request.body.mode;

      if (!mode || !validPermissionModes.includes(mode)) {
        return reply.code(400).send({ error: `"mode" must be one of: ${validPermissionModes.join(', ')}` });
      }

      updateSession(sessionId, { permissionMode: mode });

      let applied: 'live' | 'pending' = 'pending';

      if (session.status === 'running' || session.status === 'waiting_permission') {
        try {
          const changedLive = await claudeRuntime.setPermissionMode(sessionId, mode);

          if (changedLive) {
            applied = 'live';
          }
        } catch (err) {
          request.log.warn(err, 'setPermissionMode: failed to apply live, kept as the session default');
        }
      }

      return reply.code(200).send({ mode, applied });
    }
  );

  // Configura o sandbox do Codex para uma sessão com suas permisseos
  app.post<{ Params: { sessionId: string }; Body: SetCodexSandboxModeBody }>(
    '/v1/sessions/:sessionId/codex-sandbox-mode',
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = getSession(sessionId);

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      if (session.runtime !== 'codex') {
        return reply.code(400).send({ error: 'codex-sandbox-mode only applies to Codex sessions' });
      }

      const mode = request.body && request.body.mode;

      if (!mode || !validCodexSandboxModes.includes(mode)) {
        return reply.code(400).send({ error: `"mode" must be one of: ${validCodexSandboxModes.join(', ')}` });
      }

      updateSession(sessionId, { codexSandboxMode: mode });

      return reply.code(200).send({ mode, applied: 'pending' });
    }
  );

  // Configura o modelo de uma sessão. Mesmo padrão do /permission-mode: sempre grava como o
  // padrão usado na próxima query() (options.model), e aplica na hora também via
  // Query.setModel quando já existe uma execução em andamento
  app.post<{ Params: { sessionId: string }; Body: SetModelBody }>(
    '/v1/sessions/:sessionId/model',
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = getSession(sessionId);

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      const body = request.body;

      if (!body || !('model' in body)) {
        return reply.code(400).send({ error: '"model" is required (use null to reset to the CLI default)' });
      }

      let model = body.model;

      if (typeof model === 'string') {
        model = model.trim() || null;
      } else if (model !== null) {
        return reply.code(400).send({ error: '"model" must be a string or null' });
      }

      updateSession(sessionId, { model: model === null ? undefined : model });

      let applied: 'live' | 'pending' = 'pending';

      if (session.status === 'running' || session.status === 'waiting_permission') {
        try {
          const changedLive = await claudeRuntime.setModel(sessionId, model === null ? undefined : model);

          if (changedLive) {
            applied = 'live';
          }
        } catch (err) {
          request.log.warn(err, 'setModel: failed to apply live, kept as the session default');
        }
      }

      return reply.code(200).send({ model, applied });
    }
  );

  // Desfaz as edições de arquivo que o Claude fez até uma mensagem de usuário específica.
  app.post<{ Params: { sessionId: string }; Body: RewindFilesBody }>(
    '/v1/sessions/:sessionId/rewind',
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = getSession(sessionId);

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      const body = request.body;
      const userMessageId = body && body.userMessageId;

      if (!userMessageId || typeof userMessageId !== 'string') {
        return reply.code(400).send({ error: '"userMessageId" is required' });
      }

      let dryRun: boolean | undefined;

      if (body && 'dryRun' in body && body.dryRun !== undefined) {
        if (typeof body.dryRun !== 'boolean') {
          return reply.code(400).send({ error: '"dryRun" must be a boolean' });
        }

        dryRun = body.dryRun;
      }

      // Mesma regra do /fork: só existe conversa do lado do provedor depois da primeira mensagem.
      if (!session.providerSessionId) {
        return reply.code(409).send({ error: 'Session has no conversation to rewind yet' });
      }

      let result;

      try {
        result = await claudeRuntime.rewindFiles(session, userMessageId, dryRun !== undefined ? { dryRun } : undefined);
      } catch (err) {
        request.log.error(err, 'rewindFiles: failed to rewind files');
        return reply.code(502).send({ error: 'Failed to rewind files' });
      }

      if (!result) {
        return reply.code(409).send({ error: 'Session has no conversation to rewind yet' });
      }

      return reply.code(200).send(result);
    }
  );

  // Aprova um pedido de permissão pendente
  app.post<{ Params: { sessionId: string; permissionId: string } }>(
    '/v1/sessions/:sessionId/permissions/:permissionId/approve',
    async (request, reply) => {
      const { sessionId, permissionId } = request.params;
      const session = getSession(sessionId);

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      const resolved = claudeRuntime.resolvePermission(sessionId, permissionId, { behavior: 'allow' });

      if (!resolved) {
        return reply.code(404).send({ error: 'Permission request not found' });
      }

      return reply.code(200).send({ approved: true });
    }
  );

  // Rejeita um pedido de permissão pendente
  app.post<{ Params: { sessionId: string; permissionId: string }; Body: RejectPermissionBody }>(
    '/v1/sessions/:sessionId/permissions/:permissionId/reject',
    async (request, reply) => {
      const { sessionId, permissionId } = request.params;
      const session = getSession(sessionId);

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      let reason = 'Rejected by user';

      if (request.body && request.body.reason) {
        reason = request.body.reason;
      }

      const resolved = claudeRuntime.resolvePermission(sessionId, permissionId, { behavior: 'deny', message: reason });

      if (!resolved) {
        return reply.code(404).send({ error: 'Permission request not found' });
      }

      return reply.code(200).send({ rejected: true });
    }
  );
}
