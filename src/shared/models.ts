import type { ModelRegistry } from './types'

/**
 * OpenCode Go 可用模型。
 *
 * 经实际探测确认：所有 14 个模型都可以通过
 *   POST https://opencode.ai/zen/go/v1/chat/completions
 * 用标准 OpenAI Chat Completions body + `Authorization: Bearer <key>` 调通，
 * 不需要做协议转换。
 *
 * 注：官方 SDK 文档中 minimax-m3/m2.7/m2.5 对应的 AI SDK 包名是
 * `@ai-sdk/anthropic`，那只是 OpenCode Go 内部实现选择，
 * 并不代表对外必须使用 Anthropic 协议。
 */
export const MODEL_REGISTRY: ModelRegistry = {
    // ---- OpenAI-compatible ----
    'glm-5.1': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
    'glm-5': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
    'kimi-k2.7': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
    'kimi-k2.6': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
    'deepseek-v4-pro': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
    'deepseek-v4-flash': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
    'mimo-v2.5': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
    'mimo-v2.5-pro': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
    // ---- 也走 OpenAI Chat Completions（无需协议转换）----
    'minimax-m3': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
    'minimax-m2.7': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
    'minimax-m2.5': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
    'qwen3.7-max': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
    'qwen3.7-plus': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
    'qwen3.6-plus': { upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' },
}

export const ALL_MODEL_IDS = Object.keys(MODEL_REGISTRY)

/** 官方文档地址，用于刷新模型/价格 */
export const OPENCODE_GO_DOCS_URL = 'https://opencode.ai/docs/zh-cn/go'
