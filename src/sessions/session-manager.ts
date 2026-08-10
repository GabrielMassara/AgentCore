import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AgentSession, SessionStatus } from './session';

// Arquivo JSON local onde as sessões são persistidas
const dataDir = join(__dirname, '..', '..', 'data');
const dataFile = join(dataDir, 'sessions.json');

const sessions = new Map<string, AgentSession>();

// Lê o arquivo sessions.json e carrega as sessões salvas para a memória.
function loadSessions() {
  if (!existsSync(dataFile)) {
    return;
  }

  const raw = readFileSync(dataFile, 'utf-8');
  const savedSessions: AgentSession[] = JSON.parse(raw);

  for (const session of savedSessions) {
    // createdAt volta do JSON como string, então precisa virar Date de novo.
    session.createdAt = new Date(session.createdAt);

    // Se o processo foi reiniciado no meio de uma execução o AbortController, para nao ficar running infinitamente,
    // marca como "error"
    if (session.status === 'running' || session.status === 'waiting_permission') {
      session.status = 'error';
    }

    sessions.set(session.id, session);
  }
}

// Escreve o estado atual de todas as sessões no arquivo sessions.json.
function saveSessions() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const allSessions = Array.from(sessions.values());
  writeFileSync(dataFile, JSON.stringify(allSessions, null, 2), 'utf-8');
}

// Carrega as sessões salvas assim que este módulo é importado, na inicialização da API.
loadSessions();

export function createSession(runtime: 'claude', projectPath: string): AgentSession {
  const session: AgentSession = {
    id: randomUUID(),
    runtime,
    projectPath,
    status: 'ready',
    createdAt: new Date(),
  };

  sessions.set(session.id, session);
  saveSessions();

  return session;
}

export function getSession(id: string): AgentSession | undefined {
  return sessions.get(id);
}

export function listSessions(filter?: { status?: SessionStatus }): AgentSession[] {
  let allSessions = Array.from(sessions.values());

  if (filter && filter.status) {
    allSessions = allSessions.filter((session) => session.status === filter.status);
  }

  // Mais recentes primeiro
  allSessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return allSessions;
}

export function deleteSession(id: string): boolean {
  const deleted = sessions.delete(id);

  if (deleted) {
    saveSessions();
  }

  return deleted;
}

export function updateSession(id: string, patch: Partial<Pick<AgentSession, 'status' | 'providerSessionId'>>): AgentSession | undefined {
  const session = sessions.get(id);

  if (!session) {
    return undefined;
  }

  const updated: AgentSession = { ...session, ...patch };

  sessions.set(id, updated);
  saveSessions();

  return updated;
}

export function renameSession(id: string, title: string): AgentSession | undefined {
  const session = sessions.get(id);

  if (!session) {
    return undefined;
  }

  const updated: AgentSession = { ...session, title };

  sessions.set(id, updated);
  saveSessions();

  return updated;
}
