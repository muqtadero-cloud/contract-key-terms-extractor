// Pricing as of the prompt (approximate, verify with OpenAI pricing page)
// Prices per 1M tokens
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "o4-mini": {
    input: 0.15,    // $0.15 per 1M input tokens
    output: 0.60,   // $0.60 per 1M output tokens
  },
  "o3": {
    input: 2.50,    // $2.50 per 1M input tokens (estimated)
    output: 10.00,  // $10.00 per 1M output tokens (estimated)
  },
  "gpt-4o-mini": {
    input: 0.15,    // $0.15 per 1M input tokens
    output: 0.60,   // $0.60 per 1M output tokens
  },
};

export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["o4-mini"];
  
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  
  return inputCost + outputCost;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${(usd * 100).toFixed(4)}¢`;
  }
  return `$${usd.toFixed(4)}`;
}

export type UsageStats = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedUSD: number;
};

export function createUsageStats(
  model: string,
  inputTokens: number,
  outputTokens: number
): UsageStats {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedUSD: calculateCost(model, inputTokens, outputTokens),
  };
}

