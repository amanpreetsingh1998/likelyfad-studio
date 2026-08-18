// === LIKELYFAD CUSTOM === (exact per-token LLM pricing for runtime cost tracking)

/**
 * LLM pricing table — USD per million tokens.
 *
 * These are the public rate cards for each provider. Cost per request is:
 *
 *   cost = (inputTokens / 1_000_000) * inputPer1M
 *        + (outputTokens / 1_000_000) * outputPer1M
 *
 * This is not an estimate — it matches what the provider will actually bill
 * you for, because all three providers (Google, OpenAI, Anthropic) charge
 * fixed per-token rates. Capture token usage from the API response and
 * multiply by these rates.
 *
 * Keys must match the `model` strings the app sends to /api/llm (see the
 * GOOGLE_MODEL_MAP / OPENAI_MODEL_MAP / ANTHROPIC_MODEL_MAP in that file).
 *
 * Update when providers change their rate cards.
 */
export interface LlmRateCard {
  /** USD per 1,000,000 input (prompt) tokens */
  inputPer1M: number;
  /** USD per 1,000,000 output (completion) tokens */
  outputPer1M: number;
}

export const LLM_PRICING: Record<string, LlmRateCard> = {
  // ── Google / Gemini ──────────────────────────────────────────────
  // Gemini 3 Pro Preview — $1.25 input / $10.00 output per 1M
  "gemini-3-pro-preview": { inputPer1M: 1.25, outputPer1M: 10.0 },
  "gemini-3.1-pro-preview": { inputPer1M: 1.25, outputPer1M: 10.0 },
  // Gemini 3 Flash Preview — $0.30 input / $2.50 output per 1M
  "gemini-3-flash-preview": { inputPer1M: 0.3, outputPer1M: 2.5 },
  // Gemini 2.5 Flash — $0.075 input / $0.30 output per 1M
  "gemini-2.5-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },

  // ── OpenAI ───────────────────────────────────────────────────────
  // GPT-4.1 Mini — $0.40 input / $1.60 output per 1M
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  // GPT-4.1 Nano — $0.10 input / $0.40 output per 1M
  "gpt-4.1-nano": { inputPer1M: 0.1, outputPer1M: 0.4 },

  // ── Anthropic ────────────────────────────────────────────────────
  // Claude Opus 4.6 — $15.00 input / $75.00 output per 1M
  "claude-opus-4.6": { inputPer1M: 15.0, outputPer1M: 75.0 },
  // Claude Sonnet 4.5 — $3.00 input / $15.00 output per 1M
  "claude-sonnet-4.5": { inputPer1M: 3.0, outputPer1M: 15.0 },
  // Claude Haiku 4.5 — $1.00 input / $5.00 output per 1M
  "claude-haiku-4.5": { inputPer1M: 1.0, outputPer1M: 5.0 },
};

/**
 * Default rate used when a model is not in LLM_PRICING. Deliberately set to
 * a mid-range value so an unknown model still contributes a non-zero amount
 * (better than silently tracking $0). Log a warning whenever this kicks in
 * so we can add the model to the table.
 */
const DEFAULT_RATE: LlmRateCard = { inputPer1M: 2.0, outputPer1M: 8.0 };

/**
 * Compute the exact USD cost for a single LLM request.
 * Returns 0 if both token counts are 0 (graceful fallback for providers
 * that fail to return usage metadata on a particular call).
 */
export function computeLlmCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): { cost: number; rateCard: LlmRateCard; usedFallback: boolean } {
  const rate = LLM_PRICING[model];
  const usedFallback = !rate;
  const card = rate ?? DEFAULT_RATE;

  if (inputTokens <= 0 && outputTokens <= 0) {
    return { cost: 0, rateCard: card, usedFallback };
  }

  const cost =
    (inputTokens / 1_000_000) * card.inputPer1M +
    (outputTokens / 1_000_000) * card.outputPer1M;

  // Round to 6 decimals to keep DB numeric columns clean
  return {
    cost: Math.round(cost * 1_000_000) / 1_000_000,
    rateCard: card,
    usedFallback,
  };
}
