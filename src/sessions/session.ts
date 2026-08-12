import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

export type SessionStatus =
  | 'ready'
  | 'running'
  | 'waiting_permission'
  | 'completed'
  | 'cancelled'
  | 'error';

export type ModelUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
};

// Soma de todos os resultados da SDK ao longo da vida da sessão
export type SessionUsage = {
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  modelUsage: Record<string, ModelUsageTotals>;
};

export type AgentSession = {
  id: string;
  runtime: 'claude' | 'codex';
  projectPath: string;
  providerSessionId?: string;
  status: SessionStatus;
  createdAt: Date;
  title?: string;
  forkedFrom?: string;
  forkedFromMessageId?: string;
  tag?: string;
  permissionMode?: PermissionMode | undefined;
  model?: string | undefined;
  usage?: SessionUsage;
};
