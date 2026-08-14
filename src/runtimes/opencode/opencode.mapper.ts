import type { Event, Message, Part, ToolPart, Permission, Todo } from '@opencode-ai/sdk';
import { AgentEvent, AgentTodoItemStatus } from '../../events/agent-event';

type MessagePartDeltaEvent = {
  type: 'message.part.delta';
  properties: {
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;
    delta: string;
  };
};

type PermissionAskedEvent = {
  type: 'permission.asked';
  properties: {
    id: string;
    sessionID: string;
    permission: string;
    patterns?: string[];
    tool: { messageID: string; callID: string };
  };
};

type OpenCodeEvent = Event | MessagePartDeltaEvent | PermissionAskedEvent;

function eventSessionId(event: OpenCodeEvent): string | undefined {
  const props = event.properties as {
    sessionID?: string;
    info?: { sessionID?: string };
    part?: { sessionID?: string };
  };

  return props.sessionID ?? props.info?.sessionID ?? props.part?.sessionID;
}

// Só existe pra description de erro
function describeSessionError(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;

    if (data && typeof data === 'object' && 'message' in data && typeof (data as { message?: unknown }).message === 'string') {
      return (data as { message: string }).message;
    }
  }

  if (error && typeof error === 'object' && 'name' in error && typeof (error as { name?: unknown }).name === 'string') {
    return (error as { name: string }).name;
  }

  return 'Unknown error';
}

// Filtra dentre todos os eventos que chegam de um servidor OpenCode compartilhado só os que pertencem à sessão do provedor em questão.
export function eventBelongsToSession(event: OpenCodeEvent, providerSessionId: string): boolean {
  return eventSessionId(event) === providerSessionId;
}

// Converte Event da OpenCode SDK em AgentEvent, o formato que a API expõe via SSE.
export class OpenCodeEventMapper {
  private sessionId: string;
  private assistantMessageIds: Set<string>;
  private startedToolCallIds: Set<string>;
  private partTypes: Map<string, string>;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.assistantMessageIds = new Set();
    this.startedToolCallIds = new Set();
    this.partTypes = new Map();
  }

  map(event: OpenCodeEvent): AgentEvent[] {
    if (event.type === 'message.updated') {
      return this.mapMessageUpdated(event.properties.info);
    }

    if (event.type === 'message.part.delta') {
      return this.mapPartDelta(event.properties);
    }

    if (event.type === 'message.part.updated') {
      this.partTypes.set(event.properties.part.id, event.properties.part.type);
      return this.mapPartUpdated(event.properties.part);
    }

    if (event.type === 'permission.updated') {
      return this.mapPermission(event.properties);
    }

    if (event.type === 'permission.asked') {
      return this.mapPermissionAsked(event.properties);
    }

    if (event.type === 'todo.updated') {
      return this.mapTodo(event.properties.todos);
    }

    if (event.type === 'session.error') {
      return [{ type: 'agent.error', sessionId: this.sessionId, message: describeSessionError(event.properties.error) }];
    }

    return [];
  }

  private mapMessageUpdated(info: Message): AgentEvent[] {
    if (info.role === 'assistant') {
      this.assistantMessageIds.add(info.id);
    }

    return [];
  }

  private mapPartDelta(props: MessagePartDeltaEvent['properties']): AgentEvent[] {
    if (
      props.field !== 'text' ||
      !this.assistantMessageIds.has(props.messageID) ||
      !props.delta ||
      this.partTypes.get(props.partID) !== 'text'
    ) {
      return [];
    }

    return [{ type: 'assistant.delta', sessionId: this.sessionId, text: props.delta }];
  }

  private mapPartUpdated(part: Part): AgentEvent[] {
    if (part.type === 'text') {
      // Ignora part de texto da própria mensagem do usuário
      if (!this.assistantMessageIds.has(part.messageID) || !part.time?.end) {
        return [];
      }

      return [{ type: 'assistant.message', sessionId: this.sessionId, text: part.text, messageId: part.id }];
    }

    if (part.type === 'tool') {
      return this.mapToolPart(part);
    }

    return [];
  }

  private mapToolPart(part: ToolPart): AgentEvent[] {
    const status = part.state.status;

    if (status === 'pending') {
      return [];
    }

    if (status === 'running') {
      if (this.startedToolCallIds.has(part.callID)) {
        return [];
      }

      this.startedToolCallIds.add(part.callID);
      return [{ type: 'tool.started', sessionId: this.sessionId, tool: part.tool, input: part.state.input }];
    }

    if (status === 'completed' || status === 'error') {
      const events: AgentEvent[] = [];

      // Segurança: se "running" nunca chegou a ser visto ainda garante um tool.started antes do tool.completed.
      if (!this.startedToolCallIds.has(part.callID)) {
        events.push({ type: 'tool.started', sessionId: this.sessionId, tool: part.tool, input: part.state.input });
      }

      this.startedToolCallIds.delete(part.callID);

      events.push({
        type: 'tool.completed',
        sessionId: this.sessionId,
        tool: part.tool,
        output: status === 'completed' ? part.state.output : { error: part.state.error },
      });

      return events;
    }

    return [];
  }

  private mapPermission(permission: Permission): AgentEvent[] {
    return [
      {
        type: 'permission.requested',
        sessionId: this.sessionId,
        permissionId: permission.id,
        tool: permission.type,
        description: permission.title,
      },
    ];
  }

  private mapPermissionAsked(props: PermissionAskedEvent['properties']): AgentEvent[] {
    const patterns = props.patterns && props.patterns.length ? props.patterns.join(', ') : undefined;
    const description = patterns
      ? `Usar a permissão "${props.permission}" em "${patterns}"`
      : `Usar a permissão "${props.permission}"`;

    return [
      {
        type: 'permission.requested',
        sessionId: this.sessionId,
        permissionId: props.id,
        tool: props.permission,
        description,
      },
    ];
  }

  private mapTodo(todos: Todo[]): AgentEvent[] {
    const items = todos.map((todo): { text: string; status: AgentTodoItemStatus } => ({
      text: todo.content,
      status: todo.status === 'completed' ? 'completed' : todo.status === 'in_progress' ? 'in_progress' : 'pending',
    }));

    return [{ type: 'agent.todo_list', sessionId: this.sessionId, items }];
  }
}
