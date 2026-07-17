/**
 * Model configuration loader — reads ~/.babyAgent/models.json,
 * resolves environment variable references ($VAR_NAME), and
 * validates required fields. Fail fast on missing config / env vars.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// Types — mirrors the JSON schema
// ============================================================================

export interface ModelConfigFile {
  providers: Record<string, ProviderConfig>;
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  models: ModelInfo[];
}

export interface ModelInfo {
  id: string;
  name: string;
  input: string[];
  contextWindow: number;
  maxTokens: number;
  cost: ModelCost;
}

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Flattened model entry — one entry per model with provider-level
 * baseUrl and apiKey inlined. Used by ChatClient for model rotation.
 */
export interface ModelEntry {
  /** Provider's base URL (e.g. https://api.deepseek.com) */
  baseUrl: string;
  /** Resolved API key for this provider */
  apiKey: string;
  /** Model identifier (e.g. "deepseek-v4-flash") */
  modelId: string;
  /** Display name */
  name: string;
  /** Supported input modalities */
  input: string[];
  /** Context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens */
  maxTokens: number;
  /** Pricing information */
  cost: ModelCost;
}

// ============================================================================
// Loader
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), ".babyAgent");
const CONFIG_PATH = path.join(CONFIG_DIR, "models.json");

/**
 * Load and resolve the model configuration file.
 * Resolves $VAR_NAME references from environment variables.
 * Fail fast: throws if file missing, malformed, or required env vars unset.
 */
export async function loadModelConfig(): Promise<ModelConfigFile> {
  let raw: string;
  try {
    const exists = await fs
      .access(CONFIG_PATH)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      await createDefaultConfig();
    }
    raw = await fs.readFile(CONFIG_PATH, "utf-8");
  } catch {
    throw new Error(
      `Model config not found at ${CONFIG_PATH}. ` +
        `Create it with your provider and model definitions.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${CONFIG_PATH}: unable to parse.`);
  }

  const config = parsed as ModelConfigFile;

  // Validate top-level structure
  if (!config.providers || typeof config.providers !== "object") {
    throw new Error(`Invalid model config: missing "providers" object.`);
  }

  const providerNames = Object.keys(config.providers);
  if (providerNames.length === 0) {
    throw new Error(
      `Invalid model config: "providers" is empty. Define at least one provider.`,
    );
  }

  // Resolve $VAR_NAME / ${VAR_NAME} in provider apiKey fields
  for (const provider of Object.values(config.providers)) {
    if (typeof provider.apiKey === "string") {
      provider.apiKey = resolveEnvVarString(provider.apiKey);
    }
  }

  // Validate each provider
  for (const [name, provider] of Object.entries(config.providers)) {
    if (!provider.baseUrl) {
      throw new Error(`Provider "${name}": missing "baseUrl".`);
    }
    if (!provider.apiKey) {
      throw new Error(
        `Provider "${name}": missing "apiKey" (or the referenced env var is not set).`,
      );
    }
    if (!Array.isArray(provider.models) || provider.models.length === 0) {
      throw new Error(
        `Provider "${name}": "models" array is empty or missing.`,
      );
    }

    // Validate each model
    for (let i = 0; i < provider.models.length; i++) {
      const m = provider.models[i];
      if (!m.id) {
        throw new Error(`Provider "${name}", models[${i}]: missing "id".`);
      }
      if (!m.name) {
        throw new Error(`Provider "${name}", models[${i}]: missing "name".`);
      }
    }
  }

  return config;
}

/**
 * Flatten all providers' models into a single array.
 * Each entry carries provider-level baseUrl + apiKey alongside model info,
 * so ChatClient can rotate across models from any provider.
 */
export function getAllModels(config: ModelConfigFile): ModelEntry[] {
  const entries: ModelEntry[] = [];
  for (const [, provider] of Object.entries(config.providers)) {
    for (const model of provider.models) {
      entries.push({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        modelId: model.id,
        name: model.name,
        input: model.input,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        cost: model.cost,
      });
    }
  }
  return entries;
}

/**
 * Default config template with deepseek provider.
 * Uses $DEEPSEEK_API_KEY env var for the API key.
 */
const DEFAULT_CONFIG: ModelConfigFile = {
  providers: {
    deepseek: {
      baseUrl: "https://api.deepseek.com",
      apiKey: "$DEEPSEEK_API_KEY",
      models: [
        {
          id: "deepseek-v4-flash",
          name: "deepseek-v4-flash",
          input: ["text"],
          contextWindow: 1000000,
          maxTokens: 384000,
          cost: {
            input: 1,
            output: 2,
            cacheRead: 0.02,
            cacheWrite: 0,
          },
        },
        {
          id: "deepseek-v4-pro",
          name: "deepseek-v4-pro",
          input: ["text"],
          contextWindow: 1000000,
          maxTokens: 384000,
          cost: {
            input: 3,
            output: 6,
            cacheRead: 0.025,
            cacheWrite: 0,
          },
        },
      ],
    },
  },
};

/**
 * Create the default models.json config file.
 * Creates the ~/.babyAgent directory if needed and writes the default deepseek config.
 */
async function createDefaultConfig(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    CONFIG_PATH,
    JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
    "utf-8",
  );
}

// ============================================================================
// Helpers
// ============================================================================

const ENV_VAR_RE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;

/**
 * Replace all $VAR_NAME / ${VAR_NAME} references with process.env values.
 * Throws if a referenced env var is not set.
 */
function resolveEnvVarString(value: string): string {
  return value.replace(ENV_VAR_RE, (_match, varName: string) => {
    const envVal = process.env[varName];
    if (envVal === undefined) {
      throw new Error(
        `Environment variable "${varName}" is referenced in model config ` +
          `but not set. Set it or remove the reference.`,
      );
    }
    return envVal;
  });
}
