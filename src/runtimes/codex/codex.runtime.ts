import { spawn } from 'child_process';
import type { Codex as CodexClient, ThreadOptions, Usage } from '@openai/codex-sdk';
import { AgentRuntime, RuntimeModel } from '../agent-runtime';
import { AgentSession, CodexSessionUsage } from '../../sessions/session';
import { updateSession } from '../../sessions/session-manager';
import { publish } from '../../events/event-bus';
import { CodexEventMapper } from './codex.mapper';

// Carregado uma única vez e reaproveitado como o cliente único da Codex SDK.
let codexPromise: Promise<CodexClient> | undefined;

function getCodex(): Promise<CodexClient> {
  if (!codexPromise) {
    codexPromise = import('@openai/codex-sdk').then((mod) => new mod.Codex({ codexPathOverride: 'codex' }));
  }

  return codexPromise;
}

type CodexModelCatalogEntry = {
  slug: string;
  display_name: string;
  description?: string;
  visibility: string;
};

// Roda "codex debug models" e devolve o catálogo bruto que o binário conhece
function runCodexDebugModels(): Promise<{ models: CodexModelCatalogEntry[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', ['debug', 'models'], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`"codex debug models" exited with code ${code}: ${stderr.trim()}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`Failed to parse "codex debug models" output: ${(err as Error).message}`));
      }
    });
  });
}

// Guarda para cada sessão EM EXECUÇÃO, o AbortController do turno em andamento
const activeAbortControllers = new Map<string, AbortController>();

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  return 'Unknown error';
}

// Soma o "usage" de um turn.completed ao acumulado anterior da sessão
function accumulateCodexUsage(existing: CodexSessionUsage | undefined, usage: Usage): CodexSessionUsage {
  return {
    inputTokens: (existing?.inputTokens ?? 0) + usage.input_tokens,
    cachedInputTokens: (existing?.cachedInputTokens ?? 0) + usage.cached_input_tokens,
    cacheWriteInputTokens: (existing?.cacheWriteInputTokens ?? 0) + usage.cache_write_input_tokens,
    outputTokens: (existing?.outputTokens ?? 0) + usage.output_tokens,
    reasoningOutputTokens: (existing?.reasoningOutputTokens ?? 0) + usage.reasoning_output_tokens,
  };
}

export class CodexRuntime implements AgentRuntime {
  async sendMessage(session: AgentSession, content: string): Promise<void> {
    const abortController = new AbortController();
    activeAbortControllers.set(session.id, abortController);

    updateSession(session.id, { status: 'running' });
    publish({ type: 'agent.started', sessionId: session.id });

    const eventMapper = new CodexEventMapper(session.id);

    // Sem isso, "codex exec" recusa rodar em qualquer projectPath que não seja um repositório git já confiado
    const threadOptions: ThreadOptions = { workingDirectory: session.projectPath, skipGitRepoCheck: true };

    if (session.model) {
      threadOptions.model = session.model;
    }

    // Sem isso o CLI cai no próprio default (sandbox "read-only"), que barra qualquer escrita em disco
    threadOptions.sandboxMode = session.codexSandboxMode ?? 'workspace-write';
    threadOptions.approvalPolicy = 'never';

    if (session.codexReasoningEffort) {
      threadOptions.modelReasoningEffort = session.codexReasoningEffort;
    }

    if (session.codexWebSearchMode) {
      threadOptions.webSearchMode = session.codexWebSearchMode;
    }

    if (session.codexWebSearchEnabled !== undefined) {
      threadOptions.webSearchEnabled = session.codexWebSearchEnabled;
    }

    if (session.codexAdditionalDirectories?.length) {
      threadOptions.additionalDirectories = session.codexAdditionalDirectories;
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
          updateSession(session.id, {
            status: 'completed',
            codexUsage: accumulateCodexUsage(session.codexUsage, event.usage),
          });
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

  // Pergunta pro binário quais modelos ele suporta
  async listModels(): Promise<RuntimeModel[]> {
    const catalog = await runCodexDebugModels();

    return catalog.models
      .filter((model) => model.visibility === 'list')
      .map((model) => ({
        id: model.slug,
        displayName: model.display_name,
        description: model.description,
      }));
  }
}
