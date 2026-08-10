import { randomUUID } from 'crypto';
import { AgentSession, SessionStatus } from './session';

const sessions = new Map<string, AgentSession>();

export function createSession(runtime: 'claude', projectPath: string): AgentSession {
  const session: AgentSession = {
    id: randomUUID(),
    runtime,
    projectPath,
    status: 'ready',
    createdAt: new Date(),
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): AgentSession | undefined {
  return sessions.get(id);
}

export function updateSession(id: string, patch: Partial<Pick<AgentSession, 'status' | 'providerSessionId'>>): AgentSession | undefined {
  const session = sessions.get(id);

  if (!session) {
    return undefined;
  }

  const updated: AgentSession = { ...session, ...patch };
  
  sessions.set(id, updated);
  return updated;
}
