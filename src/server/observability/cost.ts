export type TokenPricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

export function calculateTokenCostUsd(
  inputTokens: number,
  outputTokens: number,
  pricing: TokenPricing,
): number {
  return (
    inputTokens * pricing.inputUsdPerMillion +
    outputTokens * pricing.outputUsdPerMillion
  ) / 1_000_000;
}

export function formatTokenCostUsd(cost: number): string {
  return cost.toFixed(6);
}
