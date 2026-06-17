import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { modelRouter } from '../gateway/model-router'
import { upstreamClient } from '../gateway/upstream-client'
import { keyPool } from '../keys/key-pool'
import { usageTracker } from '../usage/usage-tracker'
import {
    buildClientResponseSummary,
    buildUpstreamRequest,
    captureClientRequest,
    captureUpstreamErrorResponse,
    captureUpstreamJsonResponse,
    captureUpstreamStreamResponse,
} from '../usage/request-capture'
import { openaiError } from './errors'
import {
    extractStreamUsage,
    normalizeUsage,
    ThinkStreamTransformer,
    toOpenAIChatCompletion,
} from '../../shared/response-helpers'

/**
 * POST /v1/chat/completions —— 文档 6.2
 *
 * 链路：
 *   1. 校验模型
 *   2. 选 Key（非流式：失败可换 Key，最多重试 2 次）
 *   3. 转发到 OpenCode Go 上游
 *      - OpenAI-compatible 模型：直接透传
 *      - Anthropic 模型：转换 body / 转换 response
 *   4. 记录 Usage
 *
 * 流式：
 *   - 首 chunk 之前失败可换 Key
 *   - 首 chunk 之后失败只能结束
 */

const MAX_NON_STREAM_KEY_TRIES = 3
const MAX_STREAM_KEY_TRIES = 2

/**
 * OpenCode CLI 传过来的会话标识头。
 * 按官方实现：OpenCode 自有 provider（含 opencodego）用 x-opencode-session；
 * 通用 provider 用 x-session-affinity / X-Session-Id，子代理用 x-parent-session-id。
 */
const SESSION_HEADER_KEYS = [
    'x-opencode-session',
    'x-session-affinity',
    'x-session-id',
    'x-parent-session-id',
] as const

type SessionHeaders = Partial<Record<(typeof SESSION_HEADER_KEYS)[number], string>>

function extractSessionHeaders(
    headers: Record<string, string | string[] | undefined>
): SessionHeaders {
    const out: SessionHeaders = {}
    for (const key of SESSION_HEADER_KEYS) {
        const value = headers[key]
        if (typeof value === 'string' && value) {
            out[key] = value
        }
    }
    return out
}

export async function registerChatRoute(app: FastifyInstance) {
    app.post('/v1/chat/completions', async (req: FastifyRequest, reply: FastifyReply) => {
        const requestId = (req.headers['x-request-id'] as string) || randomUUID()
        const body = req.body as any
        if (!body || typeof body !== 'object') {
            return reply
                .code(400)
                .send(openaiError('请求体格式错误', 'invalid_request_error', 'bad_request'))
        }
        const model = String(body.model ?? '')
        if (!model) {
            return reply
                .code(400)
                .send(openaiError('缺少 model 字段', 'invalid_request_error', 'missing_model'))
        }
        if (!modelRouter.isSupported(model)) {
            return reply
                .code(400)
                .send(
                    openaiError(
                        `不支持的模型：${model}`,
                        'invalid_request_error',
                        'unsupported_model'
                    )
                )
        }
        const stream = !!body.stream
        const startedAt = Date.now()
        const sessionHeaders = extractSessionHeaders(req.headers)

        if (stream) {
            await handleStream(req, reply, { requestId, sessionHeaders, model, body, startedAt })
        } else {
            await handleNonStream(req, reply, { requestId, sessionHeaders, model, body, startedAt })
        }
    })
}

type ChatCtx = {
    requestId: string
    sessionHeaders: SessionHeaders
    model: string
    body: any
    startedAt: number
}

async function handleNonStream(req: FastifyRequest, reply: FastifyReply, ctx: ChatCtx) {
    const tried = new Set<string>()
    let lastErr: { httpStatus: number; errorCode: string; errorMessage: string } | null = null
    const clientRequest = captureClientRequest(req as any)
    // 记录最后一次成功（或最后一次失败）的上游交互，给日志用
    let lastUpstreamRequest: ReturnType<typeof buildUpstreamRequest> | undefined
    let lastUpstreamResponse:
        | ReturnType<typeof captureUpstreamJsonResponse>
        | ReturnType<typeof captureUpstreamErrorResponse>
        | undefined
    let successfulKeyId: string | undefined

    for (let attempt = 0; attempt < MAX_NON_STREAM_KEY_TRIES; attempt++) {
        const allKeys = await keyPool.list()
        const usage = await usageTracker.list({ limit: 500 })
        // 从未尝试过的 Key 中挑一个
        const candidates = allKeys.filter(k => !tried.has(k.id))
        const key = candidates.length
            ? await keyPool.select(usage.filter(u => !tried.has(u.keyId)))
            : null
        if (!key) break
        tried.add(key.id)
        const apiKey = keyPool.decrypt(key)
        const route = modelRouter.resolve(ctx.model)
        lastUpstreamRequest = buildUpstreamRequest(
            'POST',
            route.upstreamUrl,
            {
                'content-type': 'application/json',
                authorization: `Bearer ${apiKey}`,
                accept: 'application/json',
            },
            ctx.body
        )
        const result = await upstreamClient.chat(
            key,
            { model: ctx.model, body: ctx.body, stream: false, sessionHeaders: ctx.sessionHeaders },
            apiKey
        )
        if (result.ok) {
            // 归一化 Anthropic 格式响应，保持网关对客户端的 OpenAI 兼容性
            const respJson = toOpenAIChatCompletion(result.json, ctx.model)
            lastUpstreamResponse = captureUpstreamJsonResponse({
                status: result.httpStatus,
                statusText: result.statusText,
                headers: new Headers(result.responseHeaders),
                json: result.json,
            })
            const usage = normalizeUsage(result.json?.usage)
            const cost = usageTracker.costOf({
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cachedTokens: usage.cachedTokens,
                model: ctx.model,
            })
            await keyPool.markSuccess(key.id)
            successfulKeyId = key.id
            const respBody = JSON.stringify(respJson)
            await usageTracker.record({
                requestId: ctx.requestId,
                keyId: key.id,
                model: ctx.model,
                endpoint: 'chat_completions',
                stream: false,
                inputTokens: cost.inputTokens,
                outputTokens: cost.outputTokens,
                cachedTokens: cost.cachedTokens,
                estimatedCost: cost.estimatedCost,
                status: 'success',
                httpStatus: result.httpStatus,
                latencyMs: Date.now() - ctx.startedAt,
                clientRequest,
                upstreamRequest: lastUpstreamRequest,
                upstreamResponse: lastUpstreamResponse,
                clientResponse: buildClientResponseSummary(
                    200,
                    { 'content-type': 'application/json', 'x-request-id': ctx.requestId },
                    Buffer.byteLength(respBody, 'utf8'),
                    undefined,
                    respBody
                ),
            })
            reply.header('X-Request-Id', ctx.requestId)
            for (const [k, v] of Object.entries(ctx.sessionHeaders)) {
                reply.header(k, v)
            }
            return reply.send(respBody)
        }

        lastErr = {
            httpStatus: result.httpStatus,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
        }
        lastUpstreamResponse = captureUpstreamErrorResponse(
            result.httpStatus,
            result.statusText,
            new Headers(result.responseHeaders),
            result.rawBody ?? result.errorMessage
        )
        await keyPool.markFailure(key.id, {
            httpStatus: result.httpStatus,
            errorCode: result.errorCode,
            message: result.errorMessage,
        })
        // 401/403 直接终止换 Key 没意义
        if (result.httpStatus === 401 || result.httpStatus === 403) break
    }

    const finalStatus = lastErr ? 503 : 200
    const errorJson = openaiError(
        lastErr?.errorMessage ?? 'No available upstream key',
        'rate_limit_error',
        'no_available_key'
    )
    const errorBodyText = JSON.stringify(errorJson)
    await usageTracker.record({
        requestId: ctx.requestId,
        keyId: successfulKeyId ?? '',
        model: ctx.model,
        endpoint: 'chat_completions',
        stream: false,
        status: 'failed',
        httpStatus: lastErr?.httpStatus,
        errorCode: lastErr?.errorCode ?? 'no_available_key',
        errorMessage: lastErr?.errorMessage ?? 'No available upstream key',
        latencyMs: Date.now() - ctx.startedAt,
        clientRequest,
        upstreamRequest: lastUpstreamRequest,
        upstreamResponse: lastUpstreamResponse,
        clientResponse: buildClientResponseSummary(
            finalStatus,
            { 'content-type': 'application/json', 'x-request-id': ctx.requestId },
            Buffer.byteLength(errorBodyText, 'utf8'),
            undefined,
            errorBodyText
        ),
    })

    return reply.code(finalStatus).send(errorJson)
}

async function handleStream(req: FastifyRequest, reply: FastifyReply, ctx: ChatCtx) {
    const tried = new Set<string>()
    let lastErr: { httpStatus: number; errorCode: string; errorMessage: string } | null = null
    const clientRequest = captureClientRequest(req as any)
    let lastUpstreamRequest: ReturnType<typeof buildUpstreamRequest> | undefined
    let lastUpstreamResponse:
        | ReturnType<typeof captureUpstreamStreamResponse>
        | ReturnType<typeof captureUpstreamErrorResponse>
        | undefined
    let lastFirstChunkAt: number | undefined

    for (let attempt = 0; attempt < MAX_STREAM_KEY_TRIES; attempt++) {
        const allKeys = await keyPool.list()
        const candidates = allKeys.filter(k => !tried.has(k.id))
        const key = candidates.length ? await keyPool.select([]) : null
        if (!key) break
        tried.add(key.id)
        const apiKey = keyPool.decrypt(key)
        const route = modelRouter.resolve(ctx.model)
        lastUpstreamRequest = buildUpstreamRequest(
            'POST',
            route.upstreamUrl,
            {
                'content-type': 'application/json',
                authorization: `Bearer ${apiKey}`,
                accept: 'text/event-stream',
            },
            ctx.body
        )

        // 占位 usage record（流式结束后 patch）
        const usageId = await usageTracker.record({
            requestId: ctx.requestId,
            keyId: key.id,
            model: ctx.model,
            endpoint: 'chat_completions',
            stream: true,
            status: 'success', // 先标 success，失败时 patch
            latencyMs: 0,
            clientRequest,
            upstreamRequest: lastUpstreamRequest,
        })

        let firstChunkAt = 0
        let streamError: { httpStatus: number; errorCode: string; errorMessage: string } | null =
            null

        // 所有模型都走 OpenAI Chat Completions 协议；对可能包含 <think> 的响应做归一化
        const thinkTransformer = new ThinkStreamTransformer()
        const result = await upstreamClient.streamChat(
            key,
            { model: ctx.model, body: ctx.body, stream: true, sessionHeaders: ctx.sessionHeaders },
            apiKey,
            reply,
            thinkTransformer
        )
        if (result.firstChunkAt) {
            firstChunkAt = result.firstChunkAt
            lastFirstChunkAt = result.firstChunkAt
        }
        if (!result.ok) {
            streamError = {
                httpStatus: result.httpStatus,
                errorCode: result.errorCode,
                errorMessage: result.errorMessage,
            }
            lastUpstreamResponse = captureUpstreamErrorResponse(
                result.httpStatus,
                result.statusText,
                new Headers(result.responseHeaders),
                result.rawBody ?? result.errorMessage
            )
        } else {
            lastUpstreamResponse = captureUpstreamStreamResponse(
                result.httpStatus,
                result.statusText,
                new Headers(result.responseHeaders),
                result.rawStream ?? ''
            )
        }

        const success = !streamError
        if (success) {
            await keyPool.markSuccess(key.id)
            // 从 SSE 流文本中补 usage（OpenAI / Anthropic 最终 chunk 都可能带 usage）
            const streamUsage = extractStreamUsage(lastUpstreamResponse?.rawStream ?? '')
            const cost = streamUsage
                ? usageTracker.costOf({
                      inputTokens: streamUsage.inputTokens,
                      outputTokens: streamUsage.outputTokens,
                      cachedTokens: streamUsage.cachedTokens,
                      model: ctx.model,
                  })
                : undefined
            const clientStream = result.ok ? result.clientStream : undefined
            await usageTracker.patch(usageId, {
                status: 'success',
                httpStatus: 200,
                latencyMs: Date.now() - ctx.startedAt,
                firstTokenLatencyMs: firstChunkAt ? firstChunkAt - ctx.startedAt : undefined,
                inputTokens: cost?.inputTokens,
                outputTokens: cost?.outputTokens,
                cachedTokens: cost?.cachedTokens,
                estimatedCost: cost?.estimatedCost,
                upstreamResponse: lastUpstreamResponse,
                clientResponse: buildClientResponseSummary(
                    200,
                    {
                        'content-type': 'text/event-stream; charset=utf-8',
                        'x-request-id': ctx.requestId,
                    },
                    clientStream?.length
                        ? Buffer.byteLength(clientStream, 'utf8')
                        : (lastUpstreamResponse?.bodyBytes ?? 0),
                    undefined,
                    clientStream
                ),
            })
            return
        }

        // 失败
        lastErr = streamError
        if (streamError) {
            await keyPool.markFailure(key.id, {
                httpStatus: streamError.httpStatus,
                errorCode: streamError.errorCode,
                message: streamError.errorMessage,
            })
            if (streamError.httpStatus === 401 || streamError.httpStatus === 403) break
        }
        if (firstChunkAt > 0) break // 已经写出了数据，不能换 Key

        // 把这个 Key 失败也写到 usage 里
        await usageTracker.patch(usageId, {
            status: 'failed',
            httpStatus: streamError?.httpStatus,
            errorCode: streamError?.errorCode,
            errorMessage: streamError?.errorMessage,
            latencyMs: Date.now() - ctx.startedAt,
            firstTokenLatencyMs: firstChunkAt ? firstChunkAt - ctx.startedAt : undefined,
            upstreamResponse: lastUpstreamResponse,
        })

        try {
            reply.raw.end()
        } catch {
            /* ignore */
        }
    }

    // 全部 Key 失败
    const errorText = lastErr?.errorMessage ?? 'No available upstream key'
    const errorCode = lastErr?.errorCode ?? 'no_available_key'
    await usageTracker.record({
        requestId: ctx.requestId,
        keyId: '',
        model: ctx.model,
        endpoint: 'chat_completions',
        stream: true,
        status: 'failed',
        httpStatus: lastErr?.httpStatus,
        errorCode,
        errorMessage: errorText,
        latencyMs: Date.now() - ctx.startedAt,
        firstTokenLatencyMs: lastFirstChunkAt ? lastFirstChunkAt - ctx.startedAt : undefined,
        clientRequest,
        upstreamRequest: lastUpstreamRequest,
        upstreamResponse: lastUpstreamResponse,
    })

    // 客户端可能已经收到部分 SSE；这里再补一条 error chunk 友好结束
    try {
        reply.raw.write(sseErrorChunk(errorText, errorCode))
        reply.raw.end()
    } catch {
        /* ignore */
    }
}

function classify(status: number): string {
    if (status === 401 || status === 403) return 'invalid_key'
    if (status === 429) return 'rate_limited'
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

function sseDataChunk(obj: any): string {
    return 'data: ' + JSON.stringify(obj) + '\n\n'
}

function sseErrorChunk(message: string, code: string): string {
    return (
        'data: ' +
        JSON.stringify({
            error: { message, type: 'server_error', code },
        }) +
        '\n\n'
    )
}
