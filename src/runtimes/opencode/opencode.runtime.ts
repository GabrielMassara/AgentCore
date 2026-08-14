import type { OpencodeClient } from '@opencode-ai/sdk';
import { AgentRuntime, MessageAttachment, RuntimeModel } from '../agent-runtime';
import { AgentSession } from '../../sessions/session';
import { updateSession } from '../../sessions/session-manager';
import { publish } from '../../events/event-bus';

// @opencode-ai/sdk é ESM-only, mas esse projeto roda em CommonJS. Um `import` estático falharia
// (ERR_PACKAGE_PATH_NOT_EXPORTED), então usamos `import()` dinâmico para carregar o pacote.
function loadSdk() {
  return import('@opencode-ai/sdk');
}

// Servidor OpenCode default, reaproveitado entre chamadas
let defaultServer: Promise<{ client: OpencodeClient }> | null = null;

function getDefaultServer(): Promise<{ client: OpencodeClient }> {
  if (!defaultServer) {
    defaultServer = loadSdk().then(({ createOpencode }) => createOpencode()).then(({ client }) => ({ client }));
  }

  return defaultServer;
}

export class OpenCodeRuntime implements AgentRuntime {
  async sendMessage(session: AgentSession, _content: string, _attachments?: MessageAttachment[]): Promise<void> {
    updateSession(session.id, { status: 'error' });
    publish({
      type: 'agent.error',
      sessionId: session.id,
      message: 'Sessões OpenCode ainda não suportam envio de mensagens (ver docs/ROADMAP-OPENCODE.md).',
    });
  }

  // ainda vou implementar
  async cancel(_sessionId: string): Promise<void> {}

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
