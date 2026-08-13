import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TodoWriteInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';
import { AgentEvent, AgentTodoItemStatus, UserMessageAttachment } from '../../events/agent-event';

// Nome da tool nativa de plano/todo-list da Claude Code CLI
const TODO_WRITE_TOOL_NAME = 'TodoWrite';

// Reconstitui um anexo a partir do content block bruto persistido no transcript da SDK
function mapContentBlockToAttachment(block: any): UserMessageAttachment | null {
  if (block.type === 'image') {
    const source = block.source;

    if (!source || source.type !== 'base64') {
      return null;
    }

    return { kind: 'image', mediaType: source.media_type, data: source.data };
  }

  if (block.type === 'document') {
    const source = block.source;

    if (!source) {
      return null;
    }

    if (source.type === 'base64') {
      return { kind: 'document', mediaType: source.media_type, data: source.data, ...(block.title ? { filename: block.title } : {}) };
    }

    // reconverte pra base64 aqui pra manter o mesmo formato que attachments[].data usa em todo o resto.
    if (source.type === 'text') {
      return {
        kind: 'document',
        mediaType: 'text/plain',
        data: Buffer.from(source.data, 'utf-8').toString('base64'),
        ...(block.title ? { filename: block.title } : {}),
      };
    }
  }

  return null;
}

// Converte mensagens brutas da Claude Agent SDK em AgentEvent que é o formato que
// a API expõe via SSE. Deve ser criado um ClaudeEventMapper novo para cada
// execução (cada chamada de sendMessage), pois ele guarda o nome de cada tool
// usada (tool_use) para conseguir montar o evento "tool.completed" depois
// (o tool_result que a SDK manda só traz o id da tool_use, não o nome dela).
export class ClaudeEventMapper {
  private sessionId: string;
  private toolNamesByUseId: Map<string, string>;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.toolNamesByUseId = new Map();
  }

  // Recebe uma mensagem da SDK e devolve zero ou mais AgentEvent equivalentes.
  map(sdkMessage: SDKMessage): AgentEvent[] {
    const msg = sdkMessage as any;

    if (msg.type === 'assistant') {
      return this.mapAssistantMessage(msg);
    }

    if (msg.type === 'user') {
      return this.mapUserMessage(msg);
    }

    if (msg.type === 'stream_event') {
      return this.mapStreamEvent(msg);
    }

    return [];
  }

  // Mensagem "assistant" completa: pode conter texto e/ou pedidos de uso de tool.
  private mapAssistantMessage(msg: any): AgentEvent[] {
    const events: AgentEvent[] = [];
    const blocks = msg.message ? msg.message.content : undefined;

    if (!Array.isArray(blocks)) {
      return events;
    }

    for (const block of blocks) {
      if (block.type === 'text') {
        // O uuid identifica uma mensagem específica para fazer o fork
        events.push({ type: 'assistant.message', sessionId: this.sessionId, text: block.text, messageId: msg.uuid });
      }

      if (block.type === 'tool_use') {
        // Guarda o nome da tool para conseguir montar o "tool.completed"
        this.toolNamesByUseId.set(block.id, block.name);

        if (block.name === TODO_WRITE_TOOL_NAME) {
          events.push(...this.mapTodoWrite(block.input));
        } else {
          events.push({
            type: 'tool.started',
            sessionId: this.sessionId,
            tool: block.name,
            input: block.input,
          });
        }
      }
    }

    return events;
  }

  // Mensagem "user": no fluxo automático da SDK, é aqui que chega o resultado de uma tool que acabou de rodar
  private mapUserMessage(msg: any): AgentEvent[] {
    const events: AgentEvent[] = [];
    const blocks = msg.message ? msg.message.content : undefined;

    // No histórico, o CLI às vezes grava "content" como string pura em vez do array de blocks.
    if (typeof blocks === 'string') {
      if (blocks) {
        events.push({ type: 'user.message', sessionId: this.sessionId, text: blocks, messageId: msg.uuid });
      }

      return events;
    }

    if (!Array.isArray(blocks)) {
      return events;
    }

    const attachments: UserMessageAttachment[] = [];

    for (const block of blocks) {
      if (block.type === 'image' || block.type === 'document') {
        const attachment = mapContentBlockToAttachment(block);

        if (attachment) {
          attachments.push(attachment);
        }
      }
    }

    for (const block of blocks) {
      if (block.type === 'tool_result') {
        let toolName = this.toolNamesByUseId.get(block.tool_use_id);

        if (!toolName) {
          toolName = 'unknown';
        }

        
        if (toolName !== TODO_WRITE_TOOL_NAME) {
          events.push({
            type: 'tool.completed',
            sessionId: this.sessionId,
            tool: toolName,
            output: block.content,
          });
        }
      }

      // Texto puro em uma mensagem "user" só acontece ao reproduzir histórico; o uuid vira o userMessageId do rewind.
      if (block.type === 'text') {
        events.push({
          type: 'user.message',
          sessionId: this.sessionId,
          text: block.text,
          messageId: msg.uuid,
          ...(attachments.length ? { attachments } : {}),
        });
      }
    }

    return events;
  }

  private mapTodoWrite(input: unknown): AgentEvent[] {
    const todos = (input as Partial<TodoWriteInput> | undefined)?.todos;

    if (!Array.isArray(todos)) {
      return [];
    }

    const items = todos.map((todo): { text: string; status: AgentTodoItemStatus } => ({
      text: todo.content,
      status: todo.status,
    }));

    return [{ type: 'agent.todo_list', sessionId: this.sessionId, items }];
  }

  // Mensagem "stream_event": chunks parciais da resposta, usados para o "assistant.delta".
  private mapStreamEvent(msg: any): AgentEvent[] {
    const events: AgentEvent[] = [];
    const event = msg.event;

    if (!event) {
      return events;
    }

    if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') {
      events.push({ type: 'assistant.delta', sessionId: this.sessionId, text: event.delta.text });
    }

    return events;
  }
}
