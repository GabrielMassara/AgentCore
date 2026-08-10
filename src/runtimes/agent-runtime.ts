import { AgentSession } from '../sessions/session';

export interface AgentRuntime {
  sendMessage(session: AgentSession, content: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
}
