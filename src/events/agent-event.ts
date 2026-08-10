// Contrato de eventos exposto pela API via SSE
export type AgentEvent =
  | { type: 'agent.started'; sessionId: string }
  | { type: 'assistant.delta'; sessionId: string; text: string }
  | { type: 'assistant.message'; sessionId: string; text: string }
  | { type: 'tool.started'; sessionId: string; tool: string; input: unknown }
  | { type: 'tool.completed'; sessionId: string; tool: string; output?: unknown }
  | { type: 'permission.requested'; sessionId: string; permissionId: string; tool: string; description: string }
  | { type: 'agent.completed'; sessionId: string }
  | { type: 'agent.cancelled'; sessionId: string }
  | { type: 'agent.error'; sessionId: string; message: string };
