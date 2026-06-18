/**
 * OpenCode Go 可用模型。
 *
 * 经实际探测确认：所有模型都可以通过
 *   POST https://opencode.ai/zen/go/v1/chat/completions
 * 用标准 OpenAI Chat Completions body + `Authorization: Bearer <key>` 调通，
 * 不需要做协议转换。
 *
 * 注：官方 SDK 文档中 minimax-m3/m2.7/m2.5 对应的 AI SDK 包名是
 * `@ai-sdk/anthropic`，那只是 OpenCode Go 内部实现选择，
 * 并不代表对外必须使用 Anthropic 协议。
 *
 * 模型列表不再硬编码：启动时从官网文档同步到 store.builtInOverrides。
 * 这里只保留默认上游 URL 和文档地址。
 */
export const DEFAULT_GO_UPSTREAM_URL = 'https://opencode.ai/zen/go/v1/chat/completions'

/** 官方文档地址，用于刷新模型/价格 */
export const OPENCODE_GO_DOCS_URL = 'https://opencode.ai/docs/zh-cn/go'
