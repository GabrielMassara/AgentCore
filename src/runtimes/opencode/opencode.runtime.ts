import type { OpencodeClient } from '@opencode-ai/sdk';
import { AgentRuntime, MessageAttachment, RuntimeModel } from '../agent-runtime';
import { AgentSession } from '../../sessions/session';
import { getSession, updateSession } from '../../sessions/session-manager';
import { publish } from '../../events/event-bus';
import { OpenCodeEventMapper, eventBelongsToSession } from './opencode.mapper';

// @opencode-ai/sdk é ESM-only, mas esse projeto roda em CommonJS. Um `import` estático falharia
// (ERR_PACKAGE_PATH_NOT_EXPORTED), então usamos `import()` dinâmico para carregar o pacote.
function loadSdk() {
  return import('@opencode-ai/sdk');
}

type OpenCodeServerHandle = { close(): void };

// Servidor OpenCode "default", único, reaproveitado por todas as sessões e projetos enquanto o processo do Adapter viver
let defaultServer: Promise<{ client: OpencodeClient; server: OpenCodeServerHandle }> | null = null;

function getDefaultServer(): Promise<{ client: OpencodeClient; server: OpenCodeServerHandle }> {
  if (!defaultServer) {
    defaultServer = loadSdk().then(({ createOpencode }) => createOpencode());

    // Um startup falho não pode deixar
    // defaultServer preso numa Promise rejeitada pra sempre: sem isso, toda chamada seguinte
    // falharia até reiniciar o processo, mesmo depois da porta ser liberada.
    defaultServer.catch(() => {
      defaultServer = null;
    });
  }

  return defaultServer;
}

// Fecha o servidor OpenCode "default", se algum já tiver sido criado (mata o processo `opencode
// serve` por baixo). Chamado no shutdown do Adapter (ver server.ts) pra não deixar esse processo
// órfão quando o processo do Adapter termina.
export async function closeOpenCodeServer(): Promise<void> {
  if (!defaultServer) {
    return;
  }

  try {
    const { server } = await defaultServer;
    server.close();
  } catch {
    // Nunca chegou a subir direito, não tem o que fechar.
  }
}

// Guarda, para cada sessão EM EXECUÇÃO, o AbortController da chamada de session.prompt() em andamento
const activeAbortControllers = new Map<string, AbortController>();

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  return 'Unknown error';
}

function parseModel(model: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!model) {
    return undefined;
  }

  const separatorIndex = model.indexOf(':');

  if (separatorIndex === -1) {
    return undefined;
  }

  return { providerID: model.slice(0, separatorIndex), modelID: model.slice(separatorIndex + 1) };
}

export class OpenCodeRuntime implements AgentRuntime {
  async sendMessage(session: AgentSession, content: string, _attachments?: MessageAttachment[]): Promise<void> {
    const { client } = await getDefaultServer();
    const directory = session.projectPath;

    const abortController = new AbortController();
    activeAbortControllers.set(session.id, abortController);

    updateSession(session.id, { status: 'running' });
    publish({ type: 'agent.started', sessionId: session.id });

    let stopConsumingEvents: (() => void) | undefined;

    try {
      let providerSessionId = session.providerSessionId;

      if (!providerSessionId) {
        const created = await client.session.create({ body: {}, query: { directory } });

        if (created.error) {
          throw new Error(`OpenCode session.create failed: ${JSON.stringify(created.error)}`);
        }

        providerSessionId = created.data.id;
        updateSession(session.id, { providerSessionId });
      }

      // Assina o stream de eventos ANTES de mandar a mensagem, senão eventos publicados logo no
      // início do turno (ex.: a primeira parte do texto) podem chegar antes da assinatura existir.
      const mapper = new OpenCodeEventMapper(session.id);
      stopConsumingEvents = await this.consumeEvents(client, providerSessionId, mapper);

      const model = parseModel(session.model);

      // "default" usa o agent "build" (o próprio padrão do servidor quando "agent" não é enviado);
      // só "plan" precisa ser explicitado, mapeado a partir de session.permissionMode
      const agent = session.permissionMode === 'plan' ? 'plan' : undefined;

      const result = await client.session.prompt({
        path: { id: providerSessionId },
        query: { directory },
        body: {
          ...(model ? { model } : {}),
          ...(agent ? { agent } : {}),
          parts: [{ type: 'text', text: content }],
        },
        signal: abortController.signal,
      });

      if (result.error) {
        throw new Error(`OpenCode session.prompt failed: ${JSON.stringify(result.error)}`);
      }

      // Quem decide completed/cancelled/error aqui é a própria resolução de prompt()
      updateSession(session.id, { status: 'completed' });
      publish({ type: 'agent.completed', sessionId: session.id });
    } catch (err) {
      if (abortController.signal.aborted) {
        updateSession(session.id, { status: 'cancelled' });
        publish({ type: 'agent.cancelled', sessionId: session.id });
      } else {
        updateSession(session.id, { status: 'error' });
        publish({ type: 'agent.error', sessionId: session.id, message: getErrorMessage(err) });
        throw err;
      }
    } finally {
      stopConsumingEvents?.();
      activeAbortControllers.delete(session.id);
    }
  }

  // Abre o stream de eventos do servidor
  private async consumeEvents(client: OpencodeClient, providerSessionId: string, mapper: OpenCodeEventMapper): Promise<() => void> {
    const subscription = await client.event.subscribe();
    const stream = subscription.stream;

    (async () => {
      try {
        for await (const event of stream) {
          if (!eventBelongsToSession(event, providerSessionId)) {
            continue;
          }

          for (const agentEvent of mapper.map(event)) {
            publish(agentEvent);
          }
        }
      } catch {
        // catch :)
      }
    })();

    return () => {
      stream.return?.(undefined);
    };
  }

  async cancel(sessionId: string): Promise<void> {
    // Destrava nosso lado caso a resposta HTTP de prompt() não feche sozinha.
    activeAbortControllers.get(sessionId)?.abort();

    const session = getSession(sessionId);

    if (!session?.providerSessionId) {
      return;
    }

    const { client } = await getDefaultServer();

    // client.session.abort() é o cancelamento de verdade
    await client.session.abort({ path: { id: session.providerSessionId }, query: { directory: session.projectPath } }).catch(() => {});
  }

  // Pergunta pro servidor OpenCode quais providers estão configurados
  async listModels(): Promise<RuntimeModel[]> {
    const { client } = await getDefaultServer();
    const { data, error } = await client.config.providers();

    if (error) {
      throw new Error(`OpenCode listModels failed: ${JSON.stringify(error)}`);
    }

    return data.providers.flatMap((provider) =>
      Object.values(provider.models).map((model) => ({
        id: `${provider.id}:${model.id}`,
        displayName: `${provider.name}: ${model.name}`,
      }))
    );
  }
}
