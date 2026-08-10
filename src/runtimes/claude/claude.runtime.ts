import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentRuntime } from '../agent-runtime';
import { AgentSession, SessionStatus } from '../../sessions/session';
import { updateSession } from '../../sessions/session-manager';

// o activeAbortControllers guarda para cada sessao EM EXECUCAO o controle remoto que permite interromper a chamada em andamento
const activeAbortControllers = new Map<string, AbortController>();

export class ClaudeRuntime implements AgentRuntime {
  async sendMessage(session: AgentSession, content: string): Promise<void> {

    // Cria um AbortController novo para esta execução e guarda no mapa
    const abortController = new AbortController();
    activeAbortControllers.set(session.id, abortController);

    // marca a sessão como "running" antes de chamar a SDK
    updateSession(session.id, { status: 'running' });

    const options: Record<string, unknown> = {
      cwd: session.projectPath,
      abortController,
    };

    // Se a sessão já tem um providerSessionId (uma conversa anterior com o Claude), usa resume para continuar a mesma conversa em vez de começar do zero
    if (session.providerSessionId) {
      options.resume = session.providerSessionId;
    }

    // Chama a Claude Agent SDK. O retorno é um async generator que vai emitindo
    // mensagens conforme o Claude processa o pedido
    const q = query({ prompt: content, options });

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
        }
      }
    } catch (err) {
      // Qualquer erro não tratado durante o loop marca a sessão como "error"
      updateSession(session.id, { status: 'error' });
      throw err;
    } finally {
      // Removo o AbortController da execucao
      activeAbortControllers.delete(session.id);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    // Busca o AbortController da execução em andamento e aborta
    activeAbortControllers.get(sessionId)?.abort();
    updateSession(sessionId, { status: 'cancelled' });
  }
}
