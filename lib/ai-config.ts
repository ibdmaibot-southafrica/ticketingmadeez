export type AiProvider = 'openai' | 'anthropic' | 'gemini'
export type AiSettings = {
  enabled: boolean
  provider: AiProvider
  bracket: '10-50' | '50-100' | '100-500'
  monthlyLimitUsd: number
}
export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  provider: 'openai',
  bracket: '10-50',
  monthlyLimitUsd: 10,
}
export const AI_BRACKETS = {
  '10-50': { min: 10, max: 50 },
  '50-100': { min: 50, max: 100 },
  '100-500': { min: 100, max: 500 },
}
export function aiProviderConfig(provider: AiProvider) {
  const prefix =
    provider === 'openai'
      ? 'TMEZ_AI'
      : provider === 'anthropic'
        ? 'TMEZ_ANTHROPIC'
        : 'TMEZ_GEMINI'
  const key = process.env[prefix + '_API_KEY'],
    model = process.env[prefix + '_MODEL']
  const inputRate = process.env[prefix + '_INPUT_USD_PER_MILLION']?.trim()
      ? Number(process.env[prefix + '_INPUT_USD_PER_MILLION'])
      : NaN,
    outputRate = process.env[prefix + '_OUTPUT_USD_PER_MILLION']?.trim()
      ? Number(process.env[prefix + '_OUTPUT_USD_PER_MILLION'])
      : NaN
  // Gemini operators must set a verified upper output bound for their chosen model,
  // including thinking tokens. No default model or undocumented prices are assumed.
  const outputTokenReserve =
    provider === 'gemini'
      ? Number(process.env.TMEZ_GEMINI_MAX_BILLABLE_OUTPUT_TOKENS ?? NaN)
      : 600
  const configured =
    !!key &&
    !!model &&
    Number.isFinite(inputRate) &&
    inputRate >= 0 &&
    Number.isFinite(outputRate) &&
    outputRate >= 0 &&
    Number.isSafeInteger(outputTokenReserve) &&
    outputTokenReserve >= 600
  return {
    provider,
    key,
    model,
    inputRate,
    outputRate,
    outputTokenReserve,
    configured,
  }
}
export function aiProviderOptions() {
  return (['openai', 'anthropic', 'gemini'] as const).map((provider) => {
    const { configured, model } = aiProviderConfig(provider)
    return {
      provider,
      name:
        provider === 'openai'
          ? 'OpenAI'
          : provider === 'anthropic'
            ? 'Claude (Anthropic)'
            : 'Gemini (Google)',
      configured,
      model: model ?? null,
    }
  })
}
export function aiCostMicros(
  inputTokens: number,
  outputTokens: number,
  inputRate: number,
  outputRate: number,
) {
  if (
    ![inputTokens, outputTokens].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    ![inputRate, outputRate].every((n) => Number.isFinite(n) && n >= 0)
  )
    throw new Error('Invalid usage or pricing')
  // Dollar rate per million tokens is also the micro-dollar rate per token.
  const cost = Math.ceil(inputTokens * inputRate + outputTokens * outputRate)
  if (!Number.isSafeInteger(cost))
    throw new Error('Usage cost exceeds supported range')
  return cost
}
