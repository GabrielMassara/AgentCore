import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentRuntime } from '../agent-runtime';
import { AgentSession, SessionStatus } from '../../sessions/session';
import { updateSession } from '../../sessions/session-manager';
import { publish } from '../../events/event-bus';
import { ClaudeEventMapper } from './claude.mapper';

// o activeAbortControllers guarda para cada sessao EM EXECUCAO o controle remoto que permite interromper a chamada em andamento
const activeAbortControllers = new Map<string, AbortController>();

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

    const options: Record<string, unknown> = {
      cwd: session.projectPath,
      abortController,
      // Habilita o envio de mensagens parciais (stream_event), usadas para
      // montar o evento "assistant.delta" enquanto o Claude ainda está escrevendo
      includePartialMessages: true,
    };

    // Se a sessão já tem um providerSessionId (uma conversa anterior com o Claude), usa resume para continuar a mesma conversa em vez de começar do zero
    if (session.providerSessionId) {
      options.resume = session.providerSessionId;
    }

    // Chama a Claude Agent SDK. O retorno é um async generator que vai emitindo
    // mensagens conforme o Claude processa o pedido
    const q = query({ prompt: content, options });

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

          updateSession(session.id, { status });

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
      // Removo o AbortController da execucao
      activeAbortControllers.delete(session.id);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    // Só sinaliza o abort aqui
    activeAbortControllers.get(sessionId)?.abort();
  }
}
