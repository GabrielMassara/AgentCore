export type SessionStatus =
  | 'ready'
  | 'running'
  | 'waiting_permission'
  | 'completed'
  | 'cancelled'
  | 'error';

export type AgentSession = {
  id: string;
  runtime: 'claude';
  projectPath: string;
  providerSessionId?: string;
  status: SessionStatus;
  createdAt: Date;
  title?: string;
  forkedFrom?: string;
  forkedFromMessageId?: string;
  tag?: string;
};
