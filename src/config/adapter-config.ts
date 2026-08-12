import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type RuntimeName = 'claude' | 'codex';

export type RuntimeConfig = {
  enabled: boolean;
};

export type AdapterConfig = {
  claude: RuntimeConfig;
  codex: RuntimeConfig;
};

// Arquivo JSON local onde as configuracoes ficam
const dataDir = join(__dirname, '..', '..', 'data');
const configFile = join(dataDir, 'config.json');

// Estado usado na primeira vez que o adapter roda, antes de existir um config.json salvo.
function defaultConfig(): AdapterConfig {
  return {
    claude: { enabled: true },
    codex: { enabled: true },
  };
}

let config: AdapterConfig = defaultConfig();

// Lê config.json, se existir, e faz merge por cima do default runtime a runtime. Assim um
// arquivo salvo antes de um novo campo existir continua carregando sem precisar de migração
function loadConfig() {
  if (!existsSync(configFile)) {
    return;
  }

  const raw = readFileSync(configFile, 'utf-8');
  const saved = JSON.parse(raw);
  const base = defaultConfig();

  config = {
    claude: { ...base.claude, ...saved.claude },
    codex: { ...base.codex, ...saved.codex },
  };
}

function saveConfig() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
}

loadConfig();

export function getConfig(): AdapterConfig {
  return config;
}

export function updateRuntimeConfig(runtime: RuntimeName, patch: Partial<RuntimeConfig>): AdapterConfig {
  config = {
    ...config,
    [runtime]: { ...config[runtime], ...patch },
  };

  saveConfig();

  return config;
}
