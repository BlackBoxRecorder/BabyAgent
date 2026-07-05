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
  defaultModel?: string;
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

// ============================================================================
// Loader
// ============================================================================

const CONFIG_PATH = path.join(os.homedir(), ".babyAgent", "models.json");

/**
 * Load and resolve the model configuration file.
 * Resolves $VAR_NAME references from environment variables.
 * Fail fast: throws if file missing, malformed, or required env vars unset.
 */
export async function loadModelConfig(): Promise<ModelConfigFile> {
  let raw: string;
  try {
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

  // Resolve env vars in all string values (recursive)
  resolveEnvVars(config);

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

    // Set default model to first model if not specified
    if (!provider.defaultModel) {
      provider.defaultModel = provider.models[0].id;
    }
  }

  return config;
}

/**
 * Get the deepseek provider config from the model config.
 * Fail fast if it's missing — this is the only supported provider for now.
 */
export function getDeepSeekProvider(config: ModelConfigFile): ProviderConfig {
  const provider = config.providers["deepseek"];
  if (!provider) {
    const available = Object.keys(config.providers).join(", ");
    throw new Error(
      `Provider "deepseek" not found in model config. ` +
        `Available providers: ${available || "(none)"}. ` +
        `Only "deepseek" is currently supported.`,
    );
  }
  return provider;
}

// ============================================================================
// Helpers
// ============================================================================

const ENV_VAR_RE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;

/**
 * Recursively walk an object tree and resolve $VAR_NAME / ${VAR_NAME}
 * references in all string values from process.env. Fail fast if a
 * referenced env var is not set.
 */
function resolveEnvVars(obj: unknown, visited?: Set<unknown>): void {
  visited ??= new Set();
  if (visited.has(obj)) return; // prevent circular references
  visited.add(obj);

  if (typeof obj === "string") {
    // This doesn't modify the string in-place because primitives are
    // immutable — instead we're relying on the fact that this function
    // processes parent objects and replaces string values. See below.
    return;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const val = obj[i];
      if (typeof val === "string") {
        obj[i] = resolveEnvVarString(val);
      } else if (val !== null && typeof val === "object") {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        resolveEnvVars(val as Record<string, unknown>, visited);
      }
    }
    return;
  }

  if (obj !== null && typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const val = record[key];
      if (typeof val === "string") {
        record[key] = resolveEnvVarString(val);
      } else if (val !== null && typeof val === "object") {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        resolveEnvVars(val as Record<string, unknown>, visited);
      }
    }
  }
}

/**
 * Replace all $VAR_NAME / ${VAR_NAME} references with process.env values.
 * Throws if a referenced env var is not set.
 */
function resolveEnvVarString(value: string): string {
  return value.replace(ENV_VAR_RE, (match, varName: string) => {
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
