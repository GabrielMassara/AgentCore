import { AgentSession } from '../sessions/session';

// Anexo imagem ou documento enviado junto de uma mensagem
export type MessageAttachment = {
  mediaType: string;
  data: string;
  kind: 'image' | 'document';
  filename?: string;
};

export interface AgentRuntime {
  sendMessage(session: AgentSession, content: string, attachments?: MessageAttachment[]): Promise<void>;
  cancel(sessionId: string): Promise<void>;
}

// Modelo que um runtime relata como disponível
export type RuntimeModel = {
  id: string;
  displayName: string;
  description?: string;
};
