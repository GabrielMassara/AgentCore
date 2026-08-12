import type { Codex as CodexClient, ThreadOptions } from '@openai/codex-sdk';
import { AgentRuntime } from '../agent-runtime';
import { AgentSession } from '../../sessions/session';
import { updateSession } from '../../sessions/session-manager';
import { publish } from '../../events/event-bus';
import { CodexEventMapper } from './codex.mapper';

// Carregado uma única vez e reaproveitado como o cliente único da Codex SDK.
let codexPromise: Promise<CodexClient> | undefined;

function getCodex(): Promise<CodexClient> {
  if (!codexPromise) {
    codexPromise = import('@openai/codex-sdk').then((mod) => new mod.Codex());
  }

  return codexPromise;
}

// Guarda para cada sessão EM EXECUÇÃO, o AbortController do turno em andamento
const activeAbortControllers = new Map<string, AbortController>();

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  return 'Unknown error';
}

export class CodexRuntime implements AgentRuntime {
  async sendMessage(session: AgentSession, content: string): Promise<void> {
    const abortController = new AbortController();
    activeAbortControllers.set(session.id, abortController);

    updateSession(session.id, { status: 'running' });
    publish({ type: 'agent.started', sessionId: session.id });

    const eventMapper = new CodexEventMapper(session.id);

    const threadOptions: ThreadOptions = { workingDirectory: session.projectPath };

    if (session.model) {
      threadOptions.model = session.model;
    }

    const codex = await getCodex();

    // Se a sessão já tem um providerSessionId usa ela em vez de começar uma conversa nova
    const thread = session.providerSessionId
      ? codex.resumeThread(session.providerSessionId, threadOptions)
      : codex.startThread(threadOptions);

    let finished = false;

    try {
      const { events } = await thread.runStreamed(content, { signal: abortController.signal });

      for await (const event of events) {
        // Primeiro evento da thread nova: grava o thread_id gerado pelo Codex para recuperar a conversa futuramente
        if (event.type === 'thread.started') {
          updateSession(session.id, { providerSessionId: event.thread_id });
        }

        if (event.type === 'turn.completed') {
          updateSession(session.id, { status: 'completed' });
          finished = true;
        }

        if (event.type === 'turn.failed' || event.type === 'error') {
          updateSession(session.id, { status: 'error' });
          finished = true;
        }

        for (const agentEvent of eventMapper.map(event)) {
          publish(agentEvent);
        }
      }
    } catch (err) {
      if (finished) {
        // A execução já tinha terminado antes desse erro
      } else if (abortController.signal.aborted) {
        // Se o erro veio de um cancel(), o AbortController já está marcado como "aborted"
        updateSession(session.id, { status: 'cancelled' });
        publish({ type: 'agent.cancelled', sessionId: session.id });
      } else {
        updateSession(session.id, { status: 'error' });
        publish({ type: 'agent.error', sessionId: session.id, message: getErrorMessage(err) });
        throw err;
      }
    } finally {
      activeAbortControllers.delete(session.id);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    // Só sinaliza o abort aqui
    activeAbortControllers.get(sessionId)?.abort();
  }
}
