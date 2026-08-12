import { AgentSession } from '../sessions/session';

export interface AgentRuntime {
  sendMessage(session: AgentSession, content: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
}

// Modelo que um runtime relata como disponível
export type RuntimeModel = {
  id: string;
  displayName: string;
  description?: string;
};
