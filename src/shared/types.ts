/**
 * 跨进程共享的类型定义。
 * 这里只放 Main / Preload / Renderer 都会用到的数据形状。
 */

export type KeyStatus = 'active' | 'cooldown' | 'disabled' | 'invalid' | 'exhausted'

export type ApiKeyRecord = {
    id: string
    name: string
    /** 加密后的 Key 主内容，绝不返回给 Renderer */
    keyCiphertext: string
    /** 形如 sk-abc1********6789 的脱敏预览 */
    keyPreview: string
    enabled: boolean
    weight: number
    status: KeyStatus
    cooldownUntil?: number
    errorCount: number
    lastUsedAt?: number
    createdAt: number
    updatedAt: number
}

export type ClientToken = {
    id: string
    name: string
    tokenHash: string
    enabled: boolean
    dailyLimit?: number
    monthlyLimit?: number
    createdAt: number
    updatedAt: number
}

export type AppSettings = {
    server: {
        host: '127.0.0.1' | '0.0.0.0'
        port: number
        enableLanAccess: boolean
    }
    auth: {
        requireGatewayToken: boolean
        /** 哈希后保存的 Gateway Token */
        gatewayTokenHash: string
    }
    startup: {
        launchAtLogin: boolean
        startMinimized: boolean
    }
    log: {
        /** 请求日志保留天数 */
        retentionDays: number
    }
    models: ModelConfig
}

export type UsageRecord = {
    id: string
    requestId: string
    keyId: string
    clientId?: string
    model: string
    endpoint: 'chat_completions' | 'messages'
    stream: boolean
    inputTokens?: number
    outputTokens?: number
    cachedTokens?: number
    estimatedCost?: number
    status: 'success' | 'failed' | 'cancelled'
    httpStatus?: number
    errorCode?: string
    errorMessage?: string
    latencyMs: number
    firstTokenLatencyMs?: number
    createdAt: number
    /**
     * 客户端 → 网关 的请求详情（mask 掉敏感 header）
     * stream 模式下 body 也会被截断到 maxBodyBytes
     */
    clientRequest?: CapturedRequest
    /**
     * 网关 → 上游 的请求详情
     */
    upstreamRequest?: CapturedRequest
    /**
     * 上游 → 网关 的响应详情
     * 非流式：完整 body；流式：原始 SSE 文本（截断）
     */
    upstreamResponse?: CapturedResponse
    /**
     * 网关 → 客户端 的响应（仅记录关键元数据；body 可能很大，省略）
     */
    clientResponse?: CapturedResponseSummary
}

export type CapturedHeaderMap = Record<string, string>

export type CapturedRequest = {
    method: string
    url: string
    headers: CapturedHeaderMap
    /** 截断后的 body 文本 */
    body: string
    /** body 截断前真实字节数 */
    bodyBytes: number
    /** body 是否被截断 */
    bodyTruncated: boolean
}

export type CapturedResponse = {
    status: number
    statusText?: string
    headers: CapturedHeaderMap
    body: string
    bodyBytes: number
    bodyTruncated: boolean
    /** 流式响应专用：原始 SSE 拼接文本 */
    rawStream?: string
}

export type CapturedResponseSummary = {
    status: number
    headers: CapturedHeaderMap
    /** body 字节数（不存内容时仍然保留） */
    bodyBytes: number
    streamChunks?: number
    /** 客户端响应 body（截断后），流式响应时为 rawStream */
    body?: string
    bodyTruncated?: boolean
    rawStream?: string
}

export type ModelRoute = {
    /** 上游完整 URL（所有模型都走 OpenAI Chat Completions 协议） */
    upstreamUrl: string
    /** 是否启用；未指定时默认为 true */
    enabled?: boolean
    /** 每 1M tokens 的美元价格（可选，来自官网） */
    inputPrice?: number
    outputPrice?: number
    cachedPrice?: number
}

export type ModelRegistry = Record<string, ModelRoute>

export type ModelConfig = {
    /** 从官网同步的内置模型覆盖表（用于更新 MODEL_REGISTRY） */
    builtInOverrides: ModelRegistry
    /** 用户自定义模型 */
    custom: ModelRegistry
    /** 被禁用的模型 id 列表（内置和自定义均可） */
    disabled: string[]
}

/** Gateway Server 状态摘要，给 Dashboard 用 */
export type GatewayStatus = {
    running: boolean
    host: string
    port: number
    requireToken: boolean
    startedAt?: number
    upstreamUrl: string
}

/** Usage 统计时间窗口 */
export type UsageWindow = '5h' | '7d' | '30d'

export type UsageSummary = {
    totalRequests: number
    successRequests: number
    failedRequests: number
    totalInputTokens: number
    totalOutputTokens: number
    totalCachedTokens: number
    estimatedCost: number
    byKey: Array<{
        keyId: string
        keyPreview: string
        requests: number
        estimatedCost: number
    }>
    byModel: Array<{
        model: string
        requests: number
        estimatedCost: number
    }>
}

export type GoUsageWindow = {
    usagePercent: number
    resetsInSeconds: number
}

export type GoUsagePlan = {
    plan?: string
    windows: {
        rolling: GoUsageWindow
        weekly: GoUsageWindow
        monthly: GoUsageWindow
    }
}
