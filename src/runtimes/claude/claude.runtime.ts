import { randomUUID } from 'crypto';
import {
  query,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  type PermissionResult,
  type PermissionMode,
  type RewindFilesResult,
} from '@anthropic-ai/claude-agent-sdk';
import { AgentRuntime, RuntimeModel } from '../agent-runtime';
import { AgentSession, SessionStatus, type SessionUsage } from '../../sessions/session';
import { updateSession } from '../../sessions/session-manager';
import { publish } from '../../events/event-bus';
import { ClaudeEventMapper } from './claude.mapper';

// o activeAbortControllers guarda para cada sessao EM EXECUCAO o controle remoto que permite interromper a chamada em andamento
const activeAbortControllers = new Map<string, AbortController>();

// Guarda, para cada sessão EM EXECUÇÃO, a Query devolvida pela SDK. Os métodos de controle
// (setPermissionMode, setModel, interrupt) só existem nesse objeto, e só funcionam quando o
// prompt foi passado em streaming-input mode (AsyncIterable) em vez de string simples.
const activeQueries = new Map<string, Query>();

async function* singleMessageStream(content: string): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  };
}

// Stream vazio, só pra manter a Query aberta em streaming-input mode até o abortController ser abortado.
async function* idleStream(signal: AbortSignal): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>(function waitForAbort(resolve) {
    if (signal.aborted) {
      resolve();
      return;
    }

    signal.addEventListener('abort', function handleAbort() {
      resolve();
    }, { once: true });
  });
}

// Guarda cada pedido de permissão esperando uma resposta (approve/reject) vinda da rota HTTP.
// "resolve" é a função que destrava a Promise que o canUseTool devolveu pra SDK.
type PendingPermission = {
  sessionId: string;
  resolve: (result: PermissionResult) => void;
};

const pendingPermissions = new Map<string, PendingPermission>();

// Soma o total_cost_usd/usage/modelUsage de uma mensagem "result" ao acumulado anterior da sessão,
// já que esses valores começam do zero a cada nova Query
function accumulateUsage(existing: SessionUsage | undefined, result: SDKResultMessage): SessionUsage {
  const usage: SessionUsage = existing
    ? { ...existing, modelUsage: { ...existing.modelUsage } }
    : { totalCostUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, modelUsage: {} };

  usage.totalCostUsd += result.total_cost_usd;
  usage.inputTokens += result.usage.input_tokens;
  usage.outputTokens += result.usage.output_tokens;
  usage.cacheReadInputTokens += result.usage.cache_read_input_tokens;
  usage.cacheCreationInputTokens += result.usage.cache_creation_input_tokens;

  for (const [model, modelUsage] of Object.entries(result.modelUsage)) {
    const totals = usage.modelUsage[model] ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0,
    };

    usage.modelUsage[model] = {
      inputTokens: totals.inputTokens + modelUsage.inputTokens,
      outputTokens: totals.outputTokens + modelUsage.outputTokens,
      cacheReadInputTokens: totals.cacheReadInputTokens + modelUsage.cacheReadInputTokens,
      cacheCreationInputTokens: totals.cacheCreationInputTokens + modelUsage.cacheCreationInputTokens,
      costUsd: totals.costUsd + modelUsage.costUSD,
    };
  }

  return usage;
}

// Pega a mensagem de um erro genérico, sem quebrar se err não for um Error de verdade.
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  return 'Unknown error';
}

export class ClaudeRuntime implements AgentRuntime {
  async sendMessage(session: AgentSession, content: string): Promise<void> {

    // Cria um AbortController novo para esta execução e guarda no mapa
    const abortController = new AbortController();
    activeAbortControllers.set(session.id, abortController);

    // marca a sessão como "running" antes de chamar a SDK
    updateSession(session.id, { status: 'running' });

    // Publica o evento de início para quem estiver ouvindo via SSE.
    publish({ type: 'agent.started', sessionId: session.id });

    // Um mapper novo por execução. ele guarda o nome de cada tool usada
    const eventMapper = new ClaudeEventMapper(session.id);

    // Chamado pela SDK sempre que uma tool precisa de aprovação antes de rodar.
    // Fica pendurado quando POST /approve ou /reject chegar,
    // ou quando a execução for cancelada enquanto ainda está esperando.
    async function canUseTool(
      toolName: string,
      _input: Record<string, unknown>,
      callOptions: { signal: AbortSignal; title?: string; description?: string }
    ): Promise<PermissionResult> {
      const permissionId = randomUUID();

      let description = `Usar a tool "${toolName}"`;

      if (callOptions.title) {
        description = callOptions.title;
      } else if (callOptions.description) {
        description = callOptions.description;
      }

      updateSession(session.id, { status: 'waiting_permission' });
      publish({ type: 'permission.requested', sessionId: session.id, permissionId, tool: toolName, description });

      return new Promise<PermissionResult>(function executor(resolve) {
        pendingPermissions.set(permissionId, { sessionId: session.id, resolve });

        // Se a execução for cancelada enquanto a permissão ainda está pendente,
        // destrava a Promise como negada em vez de deixar isso pendurado para sempre.
        callOptions.signal.addEventListener('abort', function handleAbort() {
          if (pendingPermissions.has(permissionId)) {
            pendingPermissions.delete(permissionId);
            resolve({ behavior: 'deny', message: 'Execução cancelada' });
          }
        });
      });
    }

    const options: Record<string, unknown> = {
      cwd: session.projectPath,
      abortController,
      canUseTool,
      // Habilita o envio de mensagens parciais (stream_event), usadas para
      // montar o evento "assistant.delta" enquanto o Claude ainda está escrevendo
      includePartialMessages: true,
      // Necessário para Query.rewindFiles() funcionar.
      enableFileCheckpointing: true,
    };

    // Se a sessão já tem um providerSessionId (uma conversa anterior com o Claude), usa resume para continuar a mesma conversa em vez de começar do zero
    if (session.providerSessionId) {
      options.resume = session.providerSessionId;
    }

    // Modo padrão configurado via POST /v1/sessions/:id/permission-mode antes desta execução
    // começar. Se n tiver isso a SDK usa o próprio default dela
    if (session.permissionMode) {
      options.permissionMode = session.permissionMode;
    }

    // Mesma lógica pro modelo, configurado via POST /v1/sessions/:id/model. Sem isso a SDK
    // usa o próprio default do CLI.
    if (session.model) {
      options.model = session.model;
    }

    // Chama a Claude Agent SDK. O retorno é um async generator que vai emitindo
    // mensagens conforme o Claude processa o pedido. O prompt vai como AsyncIterable
    // (streaming-input mode) para permitir setPermissionMode/setModel/interrupt durante a execução.
    const q = query({ prompt: singleMessageStream(content), options });
    activeQueries.set(session.id, q);

    // Marca se a execução já chegou a um estado final
    let finished = false;

    try {
      // percorre cada mensagem emitida pela SDK durante a execução.
      for await (const message of q) {
        const sdkMsg = message as SDKMessage;

        // A primeira mensagem com tipo "system"/"init" retorna o session_id que o Claude gera para essa conversa
        // Armazena para recuperar a conversa futuramente
        if (sdkMsg.type === 'system' && (sdkMsg as any).subtype === 'init') {
          updateSession(session.id, { providerSessionId: (sdkMsg as any).session_id });
        }

        // A mensagem do tipo "result" indica que a execução terminou.
        if (sdkMsg.type === 'result') {
          let status: SessionStatus = 'completed';

          if ((sdkMsg as any).is_error) {
            status = 'error';
          }

          updateSession(session.id, { status, usage: accumulateUsage(session.usage, sdkMsg) });

          if (status === 'completed') {
            publish({ type: 'agent.completed', sessionId: session.id });
          } else {
            publish({ type: 'agent.error', sessionId: session.id, message: (sdkMsg as any).subtype });
          }

          // A execução chegou a um estado final
          finished = true;
        }

        // Converte a mensagem da SDK em AgentEvent e publica cada um deles para os clientes SSE conectados nesta sessão.
        const events = eventMapper.map(sdkMsg);

        for (const event of events) {
          publish(event);
        }
      }
    } catch (err) {
      if (finished) {
        // A execução já tinha terminado antes desse erro
      } else if (abortController.signal.aborted) {
        // Se o erro veio de um cancel(), o AbortController já está marcado como "aborted".
        updateSession(session.id, { status: 'cancelled' });
        publish({ type: 'agent.cancelled', sessionId: session.id });
      } else {
        updateSession(session.id, { status: 'error' });
        publish({ type: 'agent.error', sessionId: session.id, message: getErrorMessage(err) });
        throw err;
      }
    } finally {
      // Removo o AbortController e a Query da execucao
      activeAbortControllers.delete(session.id);
      activeQueries.delete(session.id);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    // Só sinaliza o abort aqui
    activeAbortControllers.get(sessionId)?.abort();
  }

  // Troca o permission mode da execução em andamento. Devolve false se a sessão não tiver uma execução ativa no momento
  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<boolean> {
    const activeQuery = activeQueries.get(sessionId);

    if (!activeQuery) {
      return false;
    }

    await activeQuery.setPermissionMode(mode);
    return true;
  }

  async setModel(sessionId: string, model: string | undefined): Promise<boolean> {
    const activeQuery = activeQueries.get(sessionId);

    if (!activeQuery) {
      return false;
    }

    await activeQuery.setModel(model);
    return true;
  }

  // Pergunta pra própria CLI quais modelos ela suporta agora
  async listModels(): Promise<RuntimeModel[]> {
    const abortController = new AbortController();
    const q = query({
      prompt: idleStream(abortController.signal),
      options: { cwd: process.cwd(), abortController },
    });

    try {
      const models = await q.supportedModels();

      return models.map((model) => ({
        id: model.value,
        displayName: model.displayName,
        description: model.description,
      }));
    } finally {
      abortController.abort();
    }
  }

  // Desfaz as edições de arquivo feitas pelo Claude, restaurando o estado de uma mensagem de usuário específica.
  async rewindFiles(
    session: AgentSession,
    userMessageId: string,
    options?: { dryRun?: boolean }
  ): Promise<RewindFilesResult | null> {
    const activeQuery = activeQueries.get(session.id);

    if (activeQuery) {
      return activeQuery.rewindFiles(userMessageId, options);
    }

    if (!session.providerSessionId) {
      return null;
    }

    const abortController = new AbortController();

    const q = query({
      prompt: idleStream(abortController.signal),
      options: {
        cwd: session.projectPath,
        resume: session.providerSessionId,
        enableFileCheckpointing: true,
        abortController,
      },
    });

    try {
      return await q.rewindFiles(userMessageId, options);
    } finally {
      // Encerra a conexão à parte aberta só pra esse control request.
      abortController.abort();
    }
  }

  // Resolve um pedido de permissão pendente. Devolve false
  // se não existir nenhum pedido pendente com esse id para essa sessão.
  resolvePermission(sessionId: string, permissionId: string, result: PermissionResult): boolean {
    const pending = pendingPermissions.get(permissionId);

    if (!pending || pending.sessionId !== sessionId) {
      return false;
    }

    pendingPermissions.delete(permissionId);

    // A tool vai rodar ou não agora que a permissão foi decidida, então a sessão volta a ficar "running"
    updateSession(sessionId, { status: 'running' });

    pending.resolve(result);
    return true;
  }
}
