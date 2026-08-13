import type {
  ThreadEvent,
  ThreadItem,
  TodoListItem,
  CommandExecutionItem,
  FileChangeItem,
  McpToolCallItem,
  WebSearchItem,
} from '@openai/codex-sdk';
import { AgentEvent } from '../../events/agent-event';

type ToolItem = CommandExecutionItem | FileChangeItem | McpToolCallItem | WebSearchItem;

// Converte ThreadEvent da Codex SDK em AgentEvent, o formato que a API expõe via SSE.
// Deve ser criado um CodexEventMapper novo para cada execução ou seja, cada chamada de sendMessage
export class CodexEventMapper {
  private sessionId: string;
  private lastAgentMessageText: Map<string, string>;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.lastAgentMessageText = new Map();
  }

  map(event: ThreadEvent): AgentEvent[] {
    if (event.type === 'item.started') {
      return this.mapItemStarted(event.item);
    }

    if (event.type === 'item.updated') {
      return this.mapItemUpdated(event.item);
    }

    if (event.type === 'item.completed') {
      return this.mapItemCompleted(event.item);
    }

    if (event.type === 'turn.completed') {
      return [{ type: 'agent.completed', sessionId: this.sessionId }];
    }

    if (event.type === 'turn.failed') {
      return [{ type: 'agent.error', sessionId: this.sessionId, message: event.error.message }];
    }

    if (event.type === 'error') {
      return [{ type: 'agent.error', sessionId: this.sessionId, message: event.message }];
    }

    // "thread.started" e "turn.started" não têm AgentEvent equivalente: o thread_id é capturado
    // direto pelo CodexRuntime, e o "agent.started" já é publicado por ele antes do turno começar.
    return [];
  }

  private mapItemStarted(item: ThreadItem): AgentEvent[] {
    if (item.type === 'todo_list') {
      return this.mapTodoList(item);
    }

    if (item.type === 'agent_message') {
      this.lastAgentMessageText.set(item.id, item.text);
      return item.text ? [{ type: 'assistant.delta', sessionId: this.sessionId, text: item.text }] : [];
    }

    if (this.isToolItem(item)) {
      return [
        {
          type: 'tool.started',
          sessionId: this.sessionId,
          tool: this.toolName(item),
          input: this.toolInput(item),
        },
      ];
    }

    return [];
  }

  private mapItemUpdated(item: ThreadItem): AgentEvent[] {
    if (item.type === 'todo_list') {
      return this.mapTodoList(item);
    }

    if (item.type !== 'agent_message') {
      return [];
    }

    const previous = this.lastAgentMessageText.get(item.id) ?? '';
    const delta = item.text.startsWith(previous) ? item.text.slice(previous.length) : item.text;

    this.lastAgentMessageText.set(item.id, item.text);

    return delta ? [{ type: 'assistant.delta', sessionId: this.sessionId, text: delta }] : [];
  }

  private mapItemCompleted(item: ThreadItem): AgentEvent[] {
    if (item.type === 'todo_list') {
      return this.mapTodoList(item);
    }

    if (item.type === 'agent_message') {
      this.lastAgentMessageText.delete(item.id);
      return [{ type: 'assistant.message', sessionId: this.sessionId, text: item.text, messageId: item.id }];
    }

    if (this.isToolItem(item)) {
      return [
        {
          type: 'tool.completed',
          sessionId: this.sessionId,
          tool: this.toolName(item),
          output: this.toolOutput(item),
        },
      ];
    }

    return [];
  }

  private mapTodoList(item: TodoListItem): AgentEvent[] {
    return [{ type: 'agent.todo_list', sessionId: this.sessionId, items: item.items }];
  }

  private isToolItem(item: ThreadItem): item is ToolItem {
    return (
      item.type === 'command_execution' ||
      item.type === 'file_change' ||
      item.type === 'mcp_tool_call' ||
      item.type === 'web_search'
    );
  }

  // Nome da tool: o próprio item.type
  // FIcou mais simples que no Claude SDK ;)
  private toolName(item: ToolItem): string {
    if (item.type === 'mcp_tool_call') {
      return `mcp:${item.server}.${item.tool}`;
    }

    return item.type;
  }

  private toolInput(item: ToolItem): unknown {
    if (item.type === 'command_execution') {
      return { command: item.command };
    }

    if (item.type === 'file_change') {
      return { changes: item.changes };
    }

    if (item.type === 'mcp_tool_call') {
      return item.arguments;
    }

    return { query: item.query };
  }

  private toolOutput(item: ToolItem): unknown {
    if (item.type === 'command_execution') {
      return { status: item.status, exitCode: item.exit_code, output: item.aggregated_output };
    }

    if (item.type === 'file_change') {
      return { status: item.status, changes: item.changes };
    }

    if (item.type === 'mcp_tool_call') {
      return item.status === 'failed' ? { status: item.status, error: item.error } : { status: item.status, result: item.result };
    }

    return { query: item.query };
  }
}
