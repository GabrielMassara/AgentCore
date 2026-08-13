import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { AgentEvent, UserMessageAttachment } from '../../events/agent-event';

// Um data URL "data:<media_type>;base64,<data>", formato que o rollout usa pra embutir a imagem na resposta
const DATA_URL_PATTERN = /^data:([^;]+);base64,(.+)$/;

const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');

// Acha o arquivo onde a própria Codex CLI persiste a thread
function findRolloutFile(threadId: string, dir: string = CODEX_SESSIONS_DIR): string | null {
  let entries;

  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const found = findRolloutFile(threadId, fullPath);

      if (found) {
        return found;
      }

      continue;
    }

    if (entry.isFile() && entry.name.endsWith(`-${threadId}.jsonl`)) {
      return fullPath;
    }
  }

  return null;
}

type RolloutLine = { type: string; payload?: Record<string, unknown> };

// Reconstrói o histórico de uma thread do Codex a partir do rollout gravado em disco
export function readCodexHistory(sessionId: string, threadId: string): AgentEvent[] {
  const filePath = findRolloutFile(threadId);

  if (!filePath) {
    return [];
  }

  const lines = readFileSync(filePath, 'utf-8').split('\n').filter((line) => line.trim());
  const events: AgentEvent[] = [];
  const toolNamesByCallId = new Map<string, string>();

  // Guarda as imagens do response_item até encontrar o user_message correspondente.
  let pendingImageAttachments: UserMessageAttachment[] = [];

  for (const line of lines) {
    let record: RolloutLine;

    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record.type === 'event_msg') {
      for (const event of mapEventMsg(sessionId, record.payload)) {
        if (event.type === 'user.message' && pendingImageAttachments.length) {
          event.attachments = pendingImageAttachments;
          pendingImageAttachments = [];
        }

        events.push(event);
      }
    } else if (record.type === 'response_item') {
      pendingImageAttachments = pendingImageAttachments.concat(extractUserImageAttachments(record.payload));
      events.push(...mapResponseItem(sessionId, record.payload, toolNamesByCallId));
    }
  }

  return events;
}

// Extrai as imagens dos anexos do usuário diretamente do response_item.
function extractUserImageAttachments(payload: Record<string, unknown> | undefined): UserMessageAttachment[] {
  if (!payload || payload.type !== 'message' || payload.role !== 'user' || !Array.isArray(payload.content)) {
    return [];
  }

  const attachments: UserMessageAttachment[] = [];

  for (const block of payload.content as Array<Record<string, unknown>>) {
    if (block.type !== 'input_image' || typeof block.image_url !== 'string') {
      continue;
    }

    const match = DATA_URL_PATTERN.exec(block.image_url);

    if (match) {
      attachments.push({ kind: 'image', mediaType: match[1] as string, data: match[2] as string });
    }
  }

  return attachments;
}

function mapEventMsg(sessionId: string, payload: Record<string, unknown> | undefined): AgentEvent[] {
  if (!payload) {
    return [];
  }

  if (payload.type === 'user_message' && typeof payload.message === 'string' && payload.message) {
    return [{ type: 'user.message', sessionId, text: payload.message }];
  }

  if (payload.type === 'agent_message' && typeof payload.message === 'string' && payload.message) {
    return [{ type: 'assistant.message', sessionId, text: payload.message }];
  }

  return [];
}

function mapResponseItem(
  sessionId: string,
  payload: Record<string, unknown> | undefined,
  toolNamesByCallId: Map<string, string>
): AgentEvent[] {
  if (!payload) {
    return [];
  }

  const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;

  if (payload.type === 'function_call' && callId) {
    const toolName = typeof payload.name === 'string' ? payload.name : 'unknown';
    toolNamesByCallId.set(callId, toolName);

    return [{ type: 'tool.started', sessionId, tool: toolName, input: parseToolArguments(payload.arguments) }];
  }

  if (payload.type === 'function_call_output' && callId) {
    const toolName = toolNamesByCallId.get(callId) || 'unknown';
    return [{ type: 'tool.completed', sessionId, tool: toolName, output: payload.output }];
  }

  if (payload.type === 'custom_tool_call' && callId) {
    const toolName = typeof payload.name === 'string' ? payload.name : 'apply_patch';
    toolNamesByCallId.set(callId, toolName);

    return [{ type: 'tool.started', sessionId, tool: toolName, input: { patch: payload.input } }];
  }

  if (payload.type === 'custom_tool_call_output' && callId) {
    const toolName = toolNamesByCallId.get(callId) || 'apply_patch';
    return [{ type: 'tool.completed', sessionId, tool: toolName, output: payload.output }];
  }

  return [];
}

// payload.arguments vem como string JSON (ex.: '{"command":"...","timeout_ms":10000}').
function parseToolArguments(rawArguments: unknown): unknown {
  if (typeof rawArguments !== 'string') {
    return rawArguments;
  }

  try {
    return JSON.parse(rawArguments);
  } catch {
    return rawArguments;
  }
}
