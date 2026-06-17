/**
 * OpenAI / Anthropic 响应通用处理。
 *
 * OpenCode Go 的 /v1/chat/completions 对 minimax 等 Anthropic 内部实现模型
 * 可能返回 Anthropic 原生格式；网关侧统一归一化为 OpenAI Chat Completions 格式，
 * 并对日志 / 测试页提供内容提取辅助。
 */

export type OpenAIUsage = {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    cached_tokens?: number
}

export type AnthropicUsage = {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
}

export type NormalizedUsage = {
    inputTokens: number
    outputTokens: number
    cachedTokens: number
}

export type AnthropicContentBlock =
    | { type: 'text'; text: string }
    | { type: string; [key: string]: any }

/**
 * 判断上游 JSON 是否为 Anthropic Messages API 响应。
 */
export function isAnthropicMessageResponse(json: any): boolean {
    return (
        json &&
        json.type === 'message' &&
        Array.isArray(json.content) &&
        typeof json.role === 'string' &&
        json.role === 'assistant'
    )
}

/**
 * 从 Anthropic 内容块数组提取纯文本。
 */
export function extractAnthropicText(content?: AnthropicContentBlock[] | null): string {
    if (!Array.isArray(content)) return ''
    return content
        .filter(
            (c): c is { type: 'text'; text: string } =>
                c?.type === 'text' && typeof c.text === 'string'
        )
        .map(c => c.text)
        .join('')
}

/**
 * 从文本中解析 <think>...</think> 思考块。
 * 返回剥离标签后的正文与 reasoning 文本（如果有）。
 */
export function parseThinkTags(text: string): {
    content: string
    reasoningContent: string | undefined
} {
    if (typeof text !== 'string' || text.length === 0) {
        return { content: text ?? '', reasoningContent: undefined }
    }
    const reasoningParts: string[] = []
    // 非贪婪匹配每一对 <think>...</think>
    const content = text.replace(/<think>([\s\S]*?)<\/think>/g, (_match, thinking) => {
        reasoningParts.push(thinking)
        return ''
    })
    const reasoningContent = reasoningParts.length > 0 ? reasoningParts.join('\n') : undefined
    return { content: content.trimStart(), reasoningContent }
}

/**
 * 从 Anthropic 内容块数组提取 reasoning 文本（thinking / redacted_thinking）。
 */
export function extractAnthropicReasoning(
    content?: AnthropicContentBlock[] | null
): string | undefined {
    if (!Array.isArray(content)) return undefined
    const parts = content
        .filter((c): c is { type: string; thinking?: string } => typeof c?.type === 'string')
        .map(c => {
            if (c.type === 'thinking' && typeof c.thinking === 'string') return c.thinking
            if (c.type === 'redacted_thinking') return '[redacted thinking]'
            return ''
        })
        .filter(Boolean)
    return parts.length > 0 ? parts.join('\n') : undefined
}

/**
 * 从 Anthropic / OpenAI 响应中提取 reasoning 内容。
 */
export function extractReasoningContent(json: any): string | undefined {
    if (!json || typeof json !== 'object') return undefined
    if (isAnthropicMessageResponse(json)) {
        return extractAnthropicReasoning(json.content)
    }
    const choices = json.choices
    if (Array.isArray(choices)) {
        const first = choices[0]
        if (
            first?.message?.reasoning_content &&
            typeof first.message.reasoning_content === 'string'
        ) {
            return first.message.reasoning_content
        }
        if (first?.message?.content && typeof first.message.content === 'string') {
            return parseThinkTags(first.message.content).reasoningContent
        }
    }
    return undefined
}

/**
 * 从 Anthropic / OpenAI 响应中提取文本内容。
 */
export function extractResponseText(json: any): string {
    if (!json || typeof json !== 'object') return ''
    if (isAnthropicMessageResponse(json)) {
        return extractAnthropicText(json.content)
    }
    const choices = json.choices
    if (Array.isArray(choices)) {
        const first = choices[0]
        if (first?.message?.content && typeof first.message.content === 'string') {
            return parseThinkTags(first.message.content).content
        }
        if (first?.message?.content && Array.isArray(first.message.content)) {
            return extractAnthropicText(first.message.content)
        }
        if (typeof first?.text === 'string') {
            return first.text
        }
    }
    return ''
}

/**
 * 把 Anthropic / OpenAI 的 usage 字段归一化。
 */
export function normalizeUsage(
    usage: OpenAIUsage | AnthropicUsage | undefined | null
): NormalizedUsage {
    if (!usage || typeof usage !== 'object') {
        return { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }
    }
    const openAI = usage as OpenAIUsage
    const anthropic = usage as AnthropicUsage

    const inputTokens = openAI.prompt_tokens ?? anthropic.input_tokens ?? 0

    const outputTokens = openAI.completion_tokens ?? anthropic.output_tokens ?? 0

    const cachedTokens =
        openAI.cached_tokens ??
        anthropic.cache_read_input_tokens ??
        anthropic.cache_creation_input_tokens ??
        0

    return {
        inputTokens: Math.max(0, inputTokens),
        outputTokens: Math.max(0, outputTokens),
        cachedTokens: Math.max(0, cachedTokens),
    }
}

/**
 * 把 Anthropic Messages API 响应转换为 OpenAI Chat Completions 格式。
 * 已经是 OpenAI 格式的响应也会归一化（例如解析 <think> 标签到 reasoning_content）。
 */
export function toOpenAIChatCompletion(json: any, model: string): any {
    const usage = normalizeUsage(json?.usage)
    const stopReason = json?.stop_reason === 'end_turn' ? 'stop' : (json?.stop_reason ?? 'stop')

    let content: string
    let reasoningContent: string | undefined

    if (isAnthropicMessageResponse(json)) {
        content = extractResponseText(json)
        reasoningContent = extractAnthropicReasoning(json.content)
    } else {
        // OpenAI 格式：仅当 content 中包含 <think> 标签时才归一化，避免丢失上游额外字段
        const first = json?.choices?.[0]
        const rawContent =
            typeof first?.message?.content === 'string'
                ? first.message.content
                : typeof first?.text === 'string'
                  ? first.text
                  : ''
        const parsed = parseThinkTags(rawContent)
        if (!parsed.reasoningContent) {
            return json
        }
        content = parsed.content
        reasoningContent = parsed.reasoningContent
    }

    const message: Record<string, any> = {
        role: 'assistant',
        content,
    }
    if (reasoningContent) {
        message.reasoning_content = reasoningContent
    }

    return {
        id: json?.id ?? `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                message,
                finish_reason: stopReason,
            },
        ],
        usage: {
            prompt_tokens: usage.inputTokens,
            completion_tokens: usage.outputTokens,
            total_tokens: usage.inputTokens + usage.outputTokens,
            cached_tokens: usage.cachedTokens,
        },
    }
}

/**
 * 从 SSE 流文本中提取 usage（同时支持 OpenAI 与 Anthropic 事件）。
 * 返回最后一个包含 usage 的 chunk 的归一化结果；没有则返回 null。
 */
export function extractStreamUsage(rawStream: string): NormalizedUsage | null {
    let last: NormalizedUsage | null = null
    for (const line of rawStream.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
            const obj = JSON.parse(payload)
            // Anthropic message_delta / message_start
            const anthropicUsage = obj?.usage ?? obj?.message?.usage
            // OpenAI final chunk
            const openAIUsage = obj?.usage
            const usage = openAIUsage ?? anthropicUsage
            if (
                usage &&
                (usage.prompt_tokens !== undefined ||
                    usage.completion_tokens !== undefined ||
                    usage.input_tokens !== undefined ||
                    usage.output_tokens !== undefined)
            ) {
                last = normalizeUsage(usage)
            }
        } catch {
            /* ignore invalid json */
        }
    }
    return last
}

/**
 * 流式响应 <think> 标签转换器。
 *
 * 把上游 SSE chunk 中混在 content 里的 <think>...</think> 实时拆分为
 * delta.reasoning_content 与 delta.content，兼容支持 reasoning_content 的 OpenAI 客户端。
 */
export class ThinkStreamTransformer {
    private inThink = false
    private buffer = ''
    private readonly openTag = '<think>'
    private readonly closeTag = '</think>'

    /**
     * 处理单个 SSE data 对象，返回需要向下游发送的 chunk 数组。
     * 不含 content 的 chunk 会原样返回。
     */
    transform(chunk: any): any[] {
        const delta = chunk?.choices?.[0]?.delta
        if (!delta || typeof delta.content !== 'string') {
            return [chunk]
        }

        // 空 content 但携带 finish_reason 等其他字段时原样透传
        if (delta.content === '') {
            const hasOtherFields = Object.keys(delta).some(k => k !== 'content')
            return hasOtherFields ? [chunk] : []
        }

        this.buffer += delta.content
        const out: any[] = []

        while (this.buffer.length > 0) {
            if (this.inThink) {
                const closeIdx = this.buffer.indexOf(this.closeTag)
                if (closeIdx === -1) {
                    // 防止 close 标签缺失导致无限缓冲
                    if (this.buffer.length > 4096) {
                        out.push(this.makeChunk(chunk, '', this.buffer))
                        this.buffer = ''
                    }
                    break
                }
                const reasoning = this.buffer.slice(0, closeIdx)
                if (reasoning) {
                    out.push(this.makeChunk(chunk, '', reasoning))
                }
                this.buffer = this.buffer.slice(closeIdx + this.closeTag.length)
                this.inThink = false
            } else {
                const openIdx = this.buffer.indexOf(this.openTag)
                if (openIdx === -1) {
                    const safeLen = this.flushableContentLength(this.buffer, this.openTag)
                    if (safeLen > 0) {
                        out.push(this.makeChunk(chunk, this.buffer.slice(0, safeLen), ''))
                    }
                    this.buffer = this.buffer.slice(safeLen)
                    break
                }
                const content = this.buffer.slice(0, openIdx)
                if (content) {
                    out.push(this.makeChunk(chunk, content, ''))
                }
                this.buffer = this.buffer.slice(openIdx + this.openTag.length)
                this.inThink = true
            }
        }

        return out
    }

    /**
     * 流结束时刷新残余缓冲。
     */
    flush(template: any): any[] {
        if (!this.buffer) return []
        if (this.inThink) {
            return [this.makeChunk(template, '', this.buffer)]
        }
        return [this.makeChunk(template, this.buffer, '')]
    }

    /**
     * 计算当前 buffer 中可以安全作为 content 刷出的长度，
     * 保留末尾可能成为 <think> 前缀的字符，避免标签被切成两半。
     */
    private flushableContentLength(buffer: string, tag: string): number {
        const lastLt = buffer.lastIndexOf('<')
        if (lastLt === -1) return buffer.length
        const remain = buffer.length - lastLt
        if (remain >= tag.length) return buffer.length
        return lastLt
    }

    private makeChunk(template: any, content: string, reasoningContent: string): any {
        const chunk = JSON.parse(JSON.stringify(template))
        const delta = chunk?.choices?.[0]?.delta
        if (!delta) return chunk
        if (content) delta.content = content
        else delete delta.content
        if (reasoningContent) delta.reasoning_content = reasoningContent
        else delete delta.reasoning_content
        return chunk
    }
}

/**
 * 把一段 SSE 文本按行转换（用于日志后处理或测试）。
 */
export function transformSSEStream(rawStream: string, transformer: ThinkStreamTransformer): string {
    const out: string[] = []
    for (const line of rawStream.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) {
            out.push(line)
            continue
        }
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') {
            out.push(line)
            continue
        }
        try {
            const obj = JSON.parse(payload)
            const transformed = transformer.transform(obj)
            for (const t of transformed) {
                out.push(`data: ${JSON.stringify(t)}`)
            }
        } catch {
            out.push(line)
        }
    }
    return out.join('\n')
}
