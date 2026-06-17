import { modelRouter } from './model-router'
import type { ApiKeyRecord } from '../../shared/types'
import type { FastifyReply } from 'fastify'
import { ThinkStreamTransformer } from '../../shared/response-helpers'

/**
 * UpstreamClient —— 文档 8.6
 *
 * 职责：
 *  - 用给定 Key 调用 OpenCode Go 上游
 *  - 所有模型都走 OpenAI Chat Completions 协议（/v1/chat/completions）
 *  - 鉴权统一使用 `Authorization: Bearer <key>`
 *  - 失败时把上游响应带回给调用方，由调用方决定是否换 Key
 *  - 返回值会带上响应头 / body（截断后），供 UsageLogger 记录
 */

export type ChatRequest = {
    model: string
    body: any
    stream: boolean
    /** OpenCode CLI 传入的会话标识头，需透传给上游 */
    sessionHeaders?: Record<string, string>
}

export type ChatSuccess = {
    ok: true
    httpStatus: number
    statusText?: string
    responseHeaders: Record<string, string>
    json?: any
    rawStream?: string
    /** 实际发送给客户端的流式内容（与 rawStream 可能不同，例如经过 ThinkStreamTransformer 转换后） */
    clientStream?: string
}

export type ChatFailure = {
    ok: false
    httpStatus: number
    statusText?: string
    errorCode: string
    errorMessage: string
    /** 完整错误体（如果有），透传给客户端 */
    rawBody?: string
    responseHeaders: Record<string, string>
}

export type ChatResult = ChatSuccess | ChatFailure

export class UpstreamClient {
    /** 非流式请求 */
    async chat(_rec: ApiKeyRecord, req: ChatRequest, apiKey: string): Promise<ChatResult> {
        const route = modelRouter.resolve(req.model)
        const headers = this.buildHeaders(apiKey, false, req.sessionHeaders)
        try {
            const resp = await fetch(route.upstreamUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(req.body),
            })
            const responseHeaders = headersToObject(resp.headers)
            if (!resp.ok) {
                const text = await safeText(resp)
                return {
                    ok: false,
                    httpStatus: resp.status,
                    statusText: resp.statusText,
                    errorCode: classify(resp.status),
                    errorMessage: text.slice(0, 500),
                    rawBody: text,
                    responseHeaders,
                }
            }
            const json = await resp.json()
            return {
                ok: true,
                httpStatus: resp.status,
                statusText: resp.statusText,
                responseHeaders,
                json,
            }
        } catch (e: any) {
            return {
                ok: false,
                httpStatus: 0,
                errorCode: 'network_error',
                errorMessage: e?.message ?? String(e),
                responseHeaders: {},
            }
        }
    }

    /**
     * 流式请求。把上游 SSE 透传到客户端 reply。
     * 同时把整段 SSE 文本（截断后）返回给调用方用于日志。
     *
     * 当传入 transformer 时，会按行解析 SSE data 事件并应用转换，
     * 使下游客户端收到格式归一化的 chunk。
     */
    async streamChat(
        _rec: ApiKeyRecord,
        req: ChatRequest,
        apiKey: string,
        reply: FastifyReply,
        transformer?: ThinkStreamTransformer
    ): Promise<ChatResult & { firstChunkAt?: number }> {
        const route = modelRouter.resolve(req.model)
        const headers = this.buildHeaders(apiKey, true, req.sessionHeaders)

        // 客户端 SSE header
        reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        reply.raw.setHeader('Cache-Control', 'no-cache')
        reply.raw.setHeader('Connection', 'keep-alive')
        reply.raw.setHeader('X-Accel-Buffering', 'no')
        reply.raw.flushHeaders()

        let resp: Response
        try {
            resp = await fetch(route.upstreamUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(req.body),
            })
        } catch (e: any) {
            return {
                ok: false,
                httpStatus: 0,
                errorCode: 'network_error',
                errorMessage: e?.message ?? String(e),
                responseHeaders: {},
            }
        }

        if (!resp.ok || !resp.body) {
            const text = await safeText(resp)
            return {
                ok: false,
                httpStatus: resp.status,
                statusText: resp.statusText,
                errorCode: classify(resp.status),
                errorMessage: text.slice(0, 500),
                rawBody: text,
                responseHeaders: headersToObject(resp.headers),
            }
        }

        const reader = resp.body.getReader()
        const decoder = new TextDecoder('utf-8')
        const rawCollector: string[] = [] // 收集整段原始 SSE 文本（用于日志）
        const clientCollector: string[] = [] // 收集实际发送给客户端的 SSE 文本
        let totalBytes = 0
        const MAX_LOG_BYTES = 256 * 1024
        let firstChunkAt = 0
        let lineBuffer = ''

        try {
            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                if (!firstChunkAt) firstChunkAt = Date.now()
                const text = decoder.decode(value, { stream: true })
                if (totalBytes < MAX_LOG_BYTES) {
                    const remain = MAX_LOG_BYTES - totalBytes
                    if (text.length <= remain) {
                        rawCollector.push(text)
                        totalBytes += Buffer.byteLength(text, 'utf8')
                    } else {
                        rawCollector.push(text.slice(0, remain))
                        totalBytes = MAX_LOG_BYTES
                    }
                }

                if (transformer) {
                    lineBuffer += text
                    let nlIdx: number
                    while ((nlIdx = lineBuffer.indexOf('\n')) !== -1) {
                        const line = lineBuffer.slice(0, nlIdx)
                        lineBuffer = lineBuffer.slice(nlIdx + 1)
                        const written = this.writeSseLine(line, reply, transformer)
                        clientCollector.push(written)
                    }
                } else {
                    reply.raw.write(text)
                    clientCollector.push(text)
                }
            }

            if (transformer) {
                if (lineBuffer) {
                    const written = this.writeSseLine(lineBuffer, reply, transformer)
                    clientCollector.push(written)
                }
                const flushed = transformer.flush({})
                for (const chunk of flushed) {
                    const text = `data: ${JSON.stringify(chunk)}\n\n`
                    reply.raw.write(text)
                    clientCollector.push(text)
                }
            }
        } catch (e: any) {
            return {
                ok: false,
                httpStatus: resp.status,
                statusText: resp.statusText,
                errorCode: 'stream_broken',
                errorMessage: e?.message ?? String(e),
                responseHeaders: headersToObject(resp.headers),
                firstChunkAt: firstChunkAt || undefined,
            }
        } finally {
            try {
                reply.raw.end()
            } catch {
                /* ignore */
            }
        }
        return {
            ok: true,
            httpStatus: resp.status,
            statusText: resp.statusText,
            responseHeaders: headersToObject(resp.headers),
            rawStream: rawCollector.join(''),
            clientStream: clientCollector.join(''),
            firstChunkAt: firstChunkAt || undefined,
        }
    }

    /**
     * 处理并写出一个 SSE 行，返回实际写出的文本。
     * 若提供 transformer，则对 data: 事件进行转换。
     */
    private writeSseLine(
        line: string,
        reply: FastifyReply,
        transformer?: ThinkStreamTransformer
    ): string {
        const trimmed = line.trim()
        if (!transformer || !trimmed.startsWith('data:')) {
            const text = line + '\n'
            reply.raw.write(text)
            return text
        }

        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') {
            const text = line + '\n'
            reply.raw.write(text)
            return text
        }

        try {
            const obj = JSON.parse(payload)
            const chunks = transformer.transform(obj)
            let written = ''
            for (const chunk of chunks) {
                const text = `data: ${JSON.stringify(chunk)}\n\n`
                reply.raw.write(text)
                written += text
            }
            return written
        } catch {
            // 转换失败时回退到原样透传，避免破坏流
            const text = line + '\n'
            reply.raw.write(text)
            return text
        }
    }

    private buildHeaders(
        apiKey: string,
        stream: boolean,
        sessionHeaders?: Record<string, string>
    ): Record<string, string> {
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
            ...(sessionHeaders ?? {}),
        }
        if (stream) headers['accept'] = 'text/event-stream'
        return headers
    }
}

function classify(status: number): string {
    if (status === 401 || status === 403) return 'invalid_key'
    if (status === 429) return 'rate_limited'
    if (status === 408) return 'timeout'
    if (status >= 500) return 'upstream_error'
    return `http_${status}`
}

async function safeText(resp: Response): Promise<string> {
    try {
        return await resp.text()
    } catch {
        return ''
    }
}

function headersToObject(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {}
    headers.forEach((v, k) => {
        out[k] = v
    })
    return out
}

export const upstreamClient = new UpstreamClient()
