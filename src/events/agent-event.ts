// Anexo imagem ou documento reconstituído a partir do transcript persistido pela própria SDK
export type UserMessageAttachment = {
  mediaType: string;
  data: string;
  kind: 'image' | 'document';
  filename?: string;
};

// Contrato de eventos exposto pela API via SSE
export type AgentEvent =
  | { type: 'agent.started'; sessionId: string }
  | { type: 'user.message'; sessionId: string; text: string; messageId?: string; attachments?: UserMessageAttachment[] }
  | { type: 'assistant.delta'; sessionId: string; text: string }
  | { type: 'assistant.message'; sessionId: string; text: string; messageId?: string }
  | { type: 'tool.started'; sessionId: string; tool: string; input: unknown }
  | { type: 'tool.completed'; sessionId: string; tool: string; output?: unknown }
  | { type: 'permission.requested'; sessionId: string; permissionId: string; tool: string; description: string }
  | { type: 'agent.completed'; sessionId: string }
  | { type: 'agent.cancelled'; sessionId: string }
  | { type: 'agent.error'; sessionId: string; message: string }
  | { type: 'agent.todo_list'; sessionId: string; items: { text: string; completed: boolean }[] };
