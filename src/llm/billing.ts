/**
 * BillingCalculator — computes cost breakdown from token usage and model pricing.
 */
import type { TokenUsage, BillingInfo } from "./types.js";
import type { ModelCost } from "./models.js";

// ============================================================================
// Interface
// ============================================================================

/**
 * Computes BillingInfo from token usage and model cost rates.
 * Implementations can be swapped for different pricing models
 * (e.g. tiered pricing, enterprise discounts).
 */
export interface BillingCalculator {
  compute(usage: TokenUsage, modelCost: ModelCost): BillingInfo;
}

// ============================================================================
// Default Implementation
// ============================================================================

const PER_MILLION = 1_000_000;

/**
 * Standard billing calculator using per-token rates from ModelCost.
 * Costs are computed as: (tokens * rate_per_token) where rate_per_token = cost / 1M.
 */
export class DefaultBillingCalculator implements BillingCalculator {
  compute(usage: TokenUsage, modelCost: ModelCost): BillingInfo {
    const inputCost = (usage.prompt_tokens * modelCost.input) / PER_MILLION;
    const outputCost =
      (usage.completion_tokens * modelCost.output) / PER_MILLION;
    const cacheReadCost =
      ((usage.prompt_cache_hit_tokens ?? 0) * modelCost.cacheRead) /
      PER_MILLION;
    const cacheWriteCost =
      ((usage.prompt_cache_miss_tokens ?? 0) * modelCost.cacheWrite) /
      PER_MILLION;
    const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;

    return { inputCost, outputCost, cacheReadCost, cacheWriteCost, totalCost };
  }
}
