/**
 * 成本估算器。
 *
 * 价格来自 OpenCode Go 官方文档：https://opencode.ai/docs/zh-cn/go
 * 按每 1M tokens 的美元价格录入，计算时除以 1_000_000。
 * 未知 / 自定义模型 fallback 到相对估算值。
 */

const DEFAULT_INPUT_RATE = 0.000003
const DEFAULT_OUTPUT_RATE = 0.000015
const DEFAULT_CACHED_RATE = 0.0000003

/** 每 1M tokens 的美元价格（input / output / cached） */
const MODEL_RATES: Record<string, { input: number; output: number; cached: number }> = {
    'glm-5.1': { input: 1.4, output: 4.4, cached: 0.26 },
    'glm-5': { input: 1.0, output: 3.2, cached: 0.2 },
    'kimi-k2.7': { input: 0.95, output: 4.0, cached: 0.19 },
    'kimi-k2.6': { input: 0.95, output: 4.0, cached: 0.16 },
    'mimo-v2.5': { input: 0.14, output: 0.28, cached: 0.0028 },
    'mimo-v2.5-pro': { input: 1.74, output: 3.48, cached: 0.0145 },
    'minimax-m3': { input: 0.3, output: 1.2, cached: 0.06 },
    'minimax-m2.7': { input: 0.3, output: 1.2, cached: 0.06 },
    'minimax-m2.5': { input: 0.3, output: 1.2, cached: 0.06 },
    'qwen3.7-max': { input: 2.5, output: 7.5, cached: 0.5 },
    'qwen3.7-plus': { input: 0.4, output: 1.6, cached: 0.04 },
    'qwen3.6-plus': { input: 0.5, output: 3.0, cached: 0.05 },
    'deepseek-v4-pro': { input: 1.74, output: 3.48, cached: 0.0145 },
    'deepseek-v4-flash': { input: 0.14, output: 0.28, cached: 0.0028 },
}

export type ModelRates = { input: number; output: number; cached: number }

export type CostBreakdown = {
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    estimatedCost: number
}

function resolveRates(
    model: string | undefined,
    inputTokens: number,
    overrides?: Record<string, ModelRates>
) {
    if (!model) return defaultRates()
    const dynamic = overrides?.[model]

    return dynamic ?? MODEL_RATES[model] ?? defaultRates()
}

function defaultRates() {
    return { input: DEFAULT_INPUT_RATE, output: DEFAULT_OUTPUT_RATE, cached: DEFAULT_CACHED_RATE }
}

export function estimateCost(opts: {
    inputTokens?: number
    outputTokens?: number
    cachedTokens?: number
    model?: string
    rates?: Record<string, ModelRates>
}): CostBreakdown {
    const input = Math.max(0, opts.inputTokens ?? 0)
    const output = Math.max(0, opts.outputTokens ?? 0)
    const cached = Math.max(0, opts.cachedTokens ?? 0)
    // cachedTokens 算在 input 里；如上游同时给了 input 与 cached，则 input 已包含 cached
    const billableInput = Math.max(0, input - cached)
    const rates = resolveRates(opts.model, input, opts.rates)
    const cost =
        (billableInput * rates.input + output * rates.output + cached * rates.cached) / 1_000_000
    return {
        inputTokens: input,
        outputTokens: output,
        cachedTokens: cached,
        estimatedCost: round(cost),
    }
}

/**
 * 当上游没有返回 usage 字段时，用字符数粗估 token。
 * 经验值：英文 ~4 字符/token，中文 ~1.5 字符/token；这里取保守 3 字符/token。
 */
export function roughTokensFromText(text: string | undefined | null): number {
    if (!text) return 0
    // 简单切分：中文 / ASCII 都视为一个 token
    // 用一个保守的统计：每 3 个字符 1 token，最少 1 token
    return Math.max(1, Math.ceil(text.length / 3))
}

function round(n: number): number {
    return Math.round(n * 1_000_000) / 1_000_000
}
