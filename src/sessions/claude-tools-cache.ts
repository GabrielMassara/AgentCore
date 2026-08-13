import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Cache local, por projectPath, da lista de tools que a Claude Code CLI reportou disponível pra esse projeto
const dataDir = join(__dirname, '..', '..', 'data');
const cacheFile = join(dataDir, 'claude-tools-cache.json');

export type ClaudeToolsCacheEntry = {
  tools: string[];
  updatedAt: string;
};

const cache = new Map<string, ClaudeToolsCacheEntry>();

function loadCache(): void {
  if (!existsSync(cacheFile)) {
    return;
  }

  const raw = readFileSync(cacheFile, 'utf-8');
  const saved: Record<string, ClaudeToolsCacheEntry> = JSON.parse(raw);

  for (const [projectPath, entry] of Object.entries(saved)) {
    cache.set(projectPath, entry);
  }
}

function saveCache(): void {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const asObject: Record<string, ClaudeToolsCacheEntry> = {};

  for (const [projectPath, entry] of cache) {
    asObject[projectPath] = entry;
  }

  writeFileSync(cacheFile, JSON.stringify(asObject, null, 2), 'utf-8');
}

loadCache();

export function getCachedClaudeTools(projectPath: string): ClaudeToolsCacheEntry | undefined {
  return cache.get(projectPath);
}

// Chamado a cada system/init, pra manter o cache sempre com a lista mais recente
export function setCachedClaudeTools(projectPath: string, tools: string[]): void {
  cache.set(projectPath, { tools, updatedAt: new Date().toISOString() });
  saveCache();
}
