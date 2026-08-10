import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentEvent } from '../../events/agent-event';

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
        events.push({ type: 'assistant.message', sessionId: this.sessionId, text: block.text });
      }

      if (block.type === 'tool_use') {
        // Guarda o nome da tool para conseguir montar o "tool.completed" depois.
        this.toolNamesByUseId.set(block.id, block.name);

        events.push({
          type: 'tool.started',
          sessionId: this.sessionId,
          tool: block.name,
          input: block.input,
        });
      }
    }

    return events;
  }

  // Mensagem "user": no fluxo automático da SDK, é aqui que chega o resultado de uma tool que acabou de rodar
  private mapUserMessage(msg: any): AgentEvent[] {
    const events: AgentEvent[] = [];
    const blocks = msg.message ? msg.message.content : undefined;

    if (!Array.isArray(blocks)) {
      return events;
    }

    for (const block of blocks) {
      if (block.type === 'tool_result') {
        let toolName = this.toolNamesByUseId.get(block.tool_use_id);

        if (!toolName) {
          toolName = 'unknown';
        }

        events.push({
          type: 'tool.completed',
          sessionId: this.sessionId,
          tool: toolName,
          output: block.content,
        });
      }
    }

    return events;
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
