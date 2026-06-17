import type {
    CapturedHeaderMap,
    CapturedRequest,
    CapturedResponse,
    CapturedResponseSummary,
} from '../../shared/types'

/**
 * 请求 / 响应捕获工具。
 *
 * 设计原则：
 *  - **Mask 敏感头**：Authorization / x-api-key / cookie / set-cookie 一律替换成 "***"
 *  - **截断超大 body**：防止上下文超长把 JSON store 撑爆
 *  - **不向 Renderer 返回明文 Key**：UsageRecord 仍然只走 IPC，body 里有 Key 也只在 Main 里看
 */

const SENSITIVE_HEADER_KEYS = new Set([
    'authorization',
    'x-api-key',
    'api-key',
    'cookie',
    'set-cookie',
    'proxy-authorization',
    'x-auth-token',
    'x-access-token',
])

/** 单条 body 最大保存字节（utf-8 字节数） */
export const MAX_BODY_BYTES = 256 * 1024 // 256 KB

function maskHeader(name: string, value: string): string {
    return SENSITIVE_HEADER_KEYS.has(name.toLowerCase()) ? '***' : value
}

function maskHeaders(headers: Record<string, string | string[] | undefined>): CapturedHeaderMap {
    const out: CapturedHeaderMap = {}
    for (const [k, v] of Object.entries(headers)) {
        if (v == null) continue
        const arr = Array.isArray(v) ? v : [v]
        out[k] = arr.map(s => maskHeader(k, s)).join(', ')
    }
    return out
}

/** Node 18+ 的 Headers（fetch 用）→ 普通对象 */
function nodeHeadersToObject(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {}
    headers.forEach((v, k) => {
        out[k] = maskHeader(k, v)
    })
    return out
}

function utf8ByteLength(s: string): number {
    return Buffer.byteLength(s, 'utf8')
}

export function truncateBody(s: string): { body: string; bytes: number; truncated: boolean } {
    if (!s) return { body: '', bytes: 0, truncated: false }
    const total = utf8ByteLength(s)
    if (total <= MAX_BODY_BYTES) {
        return { body: s, bytes: total, truncated: false }
    }
    // 截断到 MAX_BODY_BYTES 字节
    const buf = Buffer.from(s, 'utf8')
    const truncated = buf.subarray(0, MAX_BODY_BYTES).toString('utf8')
    return { body: truncated, bytes: total, truncated: true }
}

export type FastifyRequestLike = {
    method: string
    url: string
    headers: Record<string, string | string[] | undefined>
    body?: any
}

export function captureClientRequest(req: FastifyRequestLike): CapturedRequest {
    const headers = maskHeaders(req.headers)
    // body 已经被 Fastify 解析成对象了；序列化回去
    let bodyText = ''
    if (req.body !== undefined && req.body !== null) {
        try {
            bodyText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
        } catch {
            bodyText = '[unserializable]'
        }
    }
    const { body, bytes, truncated } = truncateBody(bodyText)
    return {
        method: req.method,
        url: req.url,
        headers,
        body,
        bodyBytes: bytes,
        bodyTruncated: truncated,
    }
}

export function buildUpstreamRequest(
    method: string,
    url: string,
    headers: Record<string, string>,
    payload: any
): CapturedRequest {
    let bodyText = ''
    if (payload !== undefined && payload !== null) {
        if (typeof payload === 'string') bodyText = payload
        else {
            try {
                bodyText = JSON.stringify(payload)
            } catch {
                bodyText = '[unserializable]'
            }
        }
    }
    const maskedHeaders = maskHeaders(headers)
    const { body, bytes, truncated } = truncateBody(bodyText)
    return {
        method,
        url,
        headers: maskedHeaders,
        body,
        bodyBytes: bytes,
        bodyTruncated: truncated,
    }
}

export function captureUpstreamJsonResponse(resp: {
    status: number
    statusText?: string
    headers: Headers
    json: any
}): CapturedResponse {
    let bodyText = ''
    try {
        bodyText = JSON.stringify(resp.json)
    } catch {
        bodyText = '[unserializable]'
    }
    const { body, bytes, truncated } = truncateBody(bodyText)
    return {
        status: resp.status,
        statusText: resp.statusText,
        headers: nodeHeadersToObject(resp.headers),
        body,
        bodyBytes: bytes,
        bodyTruncated: truncated,
    }
}

export function captureUpstreamErrorResponse(
    status: number,
    statusText: string | undefined,
    headers: Headers,
    rawText: string
): CapturedResponse {
    const { body, bytes, truncated } = truncateBody(rawText)
    return {
        status,
        statusText,
        headers: nodeHeadersToObject(headers),
        body,
        bodyBytes: bytes,
        bodyTruncated: truncated,
    }
}

export function captureUpstreamStreamResponse(
    status: number,
    statusText: string | undefined,
    headers: Headers,
    rawStream: string
): CapturedResponse {
    const { body, bytes, truncated } = truncateBody(rawStream)
    return {
        status,
        statusText,
        headers: nodeHeadersToObject(headers),
        body: '', // 流式不存 body，避免重复
        bodyBytes: bytes,
        bodyTruncated: truncated,
        rawStream: body,
    }
}

export function buildClientResponseSummary(
    status: number,
    headers: Record<string, string | string[] | undefined>,
    bodyBytes: number,
    streamChunks?: number,
    bodyText?: string
): CapturedResponseSummary {
    const summary: CapturedResponseSummary = {
        status,
        headers: maskHeaders(headers),
        bodyBytes,
        streamChunks,
    }
    const contentType = String(headers['content-type'] ?? '').toLowerCase()
    const isStream = contentType.includes('text/event-stream')
    if (bodyText !== undefined) {
        const { body, bytes, truncated } = truncateBody(bodyText)
        summary.body = body
        summary.bodyBytes = bytes
        summary.bodyTruncated = truncated
        if (isStream) {
            summary.rawStream = body
        }
    }
    return summary
}
