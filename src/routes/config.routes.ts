import { FastifyInstance } from 'fastify';
import { getConfig, updateRuntimeConfig, RuntimeName } from '../config/adapter-config';
import { ClaudeRuntime } from '../runtimes/claude/claude.runtime';
import { CodexRuntime } from '../runtimes/codex/codex.runtime';
import { OpenCodeRuntime } from '../runtimes/opencode/opencode.runtime';
import { RuntimeModel } from '../runtimes/agent-runtime';

type RuntimeConfigPatch = { enabled?: boolean };

type UpdateConfigBody = {
  claude?: RuntimeConfigPatch;
  codex?: RuntimeConfigPatch;
  opencode?: RuntimeConfigPatch;
};

const runtimeNames: RuntimeName[] = ['claude', 'codex', 'opencode'];

// Instâncias próprias desta rota
const claudeRuntime = new ClaudeRuntime();
const codexRuntime = new CodexRuntime();
const opencodeRuntime = new OpenCodeRuntime();

function runtimeFor(name: RuntimeName): { listModels(): Promise<RuntimeModel[]> } {
  if (name === 'codex') return codexRuntime;
  if (name === 'opencode') return opencodeRuntime;
  return claudeRuntime;
}

function isValidPatch(patch: unknown): patch is RuntimeConfigPatch {
  if (typeof patch !== 'object' || patch === null) {
    return false;
  }

  const { enabled } = patch as { enabled?: unknown };

  return enabled === undefined || typeof enabled === 'boolean';
}

export default async function configRoutes(app: FastifyInstance) {
  app.get('/v1/config', async (_request, reply) => {
    return reply.send(getConfig());
  });

  // Atualiza um ou mais runtimes de uma vez
  app.patch<{ Body: UpdateConfigBody }>('/v1/config', async (request, reply) => {
    const body = request.body;

    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'Request body must include "claude", "codex" and/or "opencode"' });
    }

    const patches: Partial<Record<RuntimeName, RuntimeConfigPatch>> = {};

    for (const runtime of runtimeNames) {
      const patch = body[runtime];

      if (patch === undefined) {
        continue;
      }

      if (!isValidPatch(patch)) {
        return reply.code(400).send({ error: `"${runtime}" must be an object with optional "enabled" (boolean)` });
      }

      // Só repassa "enabled" adiante, mesmo que o body traga outras chaves para evita persistir lixo em config.json
      patches[runtime] = patch.enabled !== undefined ? { enabled: patch.enabled } : {};
    }

    if (Object.keys(patches).length === 0) {
      return reply.code(400).send({ error: 'Request body must include "claude", "codex" and/or "opencode"' });
    }

    let config = getConfig();

    for (const runtime of runtimeNames) {
      const patch = patches[runtime];

      if (patch) {
        config = updateRuntimeConfig(runtime, patch);
      }
    }

    return reply.send(config);
  });

  app.get('/v1/agents', async (request, reply) => {
    const config = getConfig();
    const enabledRuntimes = runtimeNames.filter((runtime) => config[runtime].enabled);

    const results = await Promise.all(
      enabledRuntimes.map(async (runtime) => {
        try {
          const models = await runtimeFor(runtime).listModels();
          return { runtime, models };
        } catch (err) {
          request.log.warn(err, `listModels: failed to query models for runtime "${runtime}"`);
          return null;
        }
      })
    );

    const agents = results.filter((result): result is { runtime: RuntimeName; models: RuntimeModel[] } => result !== null);

    return reply.send({ agents });
  });
}
