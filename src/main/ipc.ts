import { randomUUID } from 'node:crypto'
import { app, ipcMain, shell } from 'electron'
import { keyPool } from './keys/key-pool'
import { testKey } from './keys/key-tester'
import { usageTracker } from './usage/usage-tracker'
import { gatewayServer } from './server'
import { modelRouter } from './gateway/model-router'
import { syncModelsToStore } from './gateway/docs-sync'
import { store } from './store/json-store'
import { usageStore } from './store/usage-store'
import { TokenService } from './security/token-service'
import { refreshTrayMenu } from './tray'
import {
    buildUpstreamRequest,
    captureUpstreamErrorResponse,
    captureUpstreamJsonResponse,
    captureUpstreamStreamResponse,
} from './usage/request-capture'
import { extractStreamUsage, normalizeUsage } from '../shared/response-helpers'
import type {
    AppSettings,
    ApiKeyRecord,
    GoUsagePlan,
    UsageSummary,
    UsageWindow,
    GatewayStatus,
} from '../shared/types'

/**
 * 所有 IPC 入口。
 * 按文档 14.4：只暴露具体方法；所有入参做基础 schema 校验。
 */

function ok<T>(data: T) {
    return { ok: true, data }
}
function fail(message: string, code?: string) {
    return { ok: false, error: { message, code: code ?? 'unknown' } }
}

async function safeText(resp: Response): Promise<string> {
    try {
        return await resp.text()
    } catch {
        return ''
    }
}

function normalizeGoUsageWindow(value: any) {
    const usagePercent = Number(value?.usage_percent ?? value?.usagePercent)
    const resetsInSeconds = Number(value?.resets_in_seconds ?? value?.resetsInSeconds)
    if (!Number.isFinite(usagePercent) || !Number.isFinite(resetsInSeconds)) {
        throw new Error('OpenCode Go 用量响应格式不正确')
    }
    return {
        usagePercent: Math.max(0, Math.min(100, Math.floor(usagePercent))),
        resetsInSeconds: Math.max(0, Math.floor(resetsInSeconds)),
    }
}

function normalizeGoUsagePlan(value: any): GoUsagePlan {
    const windows = value?.windows ?? value
    return {
        plan: typeof value?.plan === 'string' ? value.plan : undefined,
        windows: {
            rolling: normalizeGoUsageWindow(windows?.rolling),
            weekly: normalizeGoUsageWindow(windows?.weekly),
            monthly: normalizeGoUsageWindow(windows?.monthly),
        },
    }
}

export function registerIpc() {
    // ---- settings ----
    ipcMain.handle('settings:get', async () => {
        const s = await store.read()
        // 抹掉 hash 字段，只返回是否设置
        const safe: AppSettings = {
            ...s.settings,
            auth: {
                ...s.settings.auth,
                gatewayTokenHash: s.settings.auth.gatewayTokenHash ? 'set' : '',
            },
        }
        return ok(safe)
    })

    ipcMain.handle('settings:update', async (_e, payload: Partial<AppSettings>) => {
        if (!payload || typeof payload !== 'object') return fail('参数错误', 'bad_request')
        await store.update(s => {
            if (payload.server) {
                s.settings.server = { ...s.settings.server, ...payload.server }
            }
            if (payload.startup) {
                s.settings.startup = { ...s.settings.startup, ...payload.startup }
            }
            if (payload.log) {
                s.settings.log = { ...s.settings.log, ...payload.log }
            }
        })
        // 重启网关
        await gatewayServer.stop()
        await gatewayServer.start()
        refreshTrayMenu()
        return ok(true)
    })

    ipcMain.handle('settings:setToken', async (_e, payload: { token: string }) => {
        if (!payload || typeof payload.token !== 'string') {
            return fail('参数错误', 'bad_request')
        }
        const hash = payload.token.length > 0 ? TokenService.hash(payload.token) : ''
        const plain = payload.token
        await store.update(s => {
            s.settings.auth.gatewayTokenHash = hash
            s.settings.auth.requireGatewayToken = !!hash
            s.gatewayTokenPlain = plain
        })
        // 网关配置变化后重启生效
        await gatewayServer.stop()
        await gatewayServer.start()
        refreshTrayMenu()
        return ok(true)
    })

    ipcMain.handle('settings:revealToken', async () => {
        const s = await store.read()
        return ok(s.gatewayTokenPlain ?? '')
    })

    // ---- models ----
    ipcMain.handle('models:list', async () => {
        return ok(modelRouter.listAll())
    })

    ipcMain.handle('models:add', async (_e, payload: { id: string; upstreamUrl: string }) => {
        if (!payload || typeof payload !== 'object') return fail('参数错误', 'bad_request')
        const id = String(payload.id ?? '').trim()
        const upstreamUrl = String(payload.upstreamUrl ?? '').trim()
        if (!id) return fail('模型 ID 不能为空', 'bad_request')
        if (!upstreamUrl) return fail('上游 URL 不能为空', 'bad_request')
        if (!/^https?:\/\//i.test(upstreamUrl)) {
            return fail('上游 URL 必须以 http:// 或 https:// 开头', 'bad_request')
        }
        await store.update(s => {
            s.settings.models.custom[id] = { upstreamUrl, enabled: true }
        })
        modelRouter.reload()
        return ok(true)
    })

    ipcMain.handle('models:remove', async (_e, payload: { id: string }) => {
        if (!payload || typeof payload.id !== 'string') return fail('参数错误', 'bad_request')
        const id = payload.id.trim()
        await store.update(s => {
            delete s.settings.models.custom[id]
            s.settings.models.disabled = s.settings.models.disabled.filter(d => d !== id)
        })
        modelRouter.reload()
        return ok(true)
    })

    ipcMain.handle('models:setEnabled', async (_e, payload: { id: string; enabled: boolean }) => {
        if (!payload || typeof payload.id !== 'string') {
            return fail('参数错误', 'bad_request')
        }
        const id = payload.id.trim()
        const enabled = !!payload.enabled
        await store.update(s => {
            const disabled = new Set(s.settings.models.disabled)
            if (enabled) {
                disabled.delete(id)
            } else {
                disabled.add(id)
            }
            s.settings.models.disabled = Array.from(disabled)
            // 自定义模型同时把 enabled 字段同步掉，避免歧义
            if (s.settings.models.custom[id]) {
                s.settings.models.custom[id].enabled = enabled
            }
        })
        modelRouter.reload()
        return ok(true)
    })

    ipcMain.handle('models:update', async (_e, payload: { id: string; upstreamUrl: string }) => {
        if (!payload || typeof payload !== 'object') return fail('参数错误', 'bad_request')
        const id = String(payload.id ?? '').trim()
        const upstreamUrl = String(payload.upstreamUrl ?? '').trim()
        if (!id) return fail('模型 ID 不能为空', 'bad_request')
        if (!upstreamUrl) return fail('上游 URL 不能为空', 'bad_request')
        if (!/^https?:\/\//i.test(upstreamUrl)) {
            return fail('上游 URL 必须以 http:// 或 https:// 开头', 'bad_request')
        }
        await store.update(s => {
            if (!s.settings.models.custom[id]) {
                throw new Error('自定义模型不存在')
            }
            s.settings.models.custom[id].upstreamUrl = upstreamUrl
        })
        modelRouter.reload()
        return ok(true)
    })

    ipcMain.handle('models:syncFromDocs', async () => {
        try {
            const synced = await syncModelsToStore()
            if (synced.length === 0) return fail('未从文档解析到模型', 'parse_error')
            return ok(synced)
        } catch (e: any) {
            return fail(e?.message ?? '同步失败', 'sync_error')
        }
    })

    // ---- keys ----
    ipcMain.handle('keys:list', async (): Promise<ReturnType<typeof ok<ApiKeyRecord[]>>> => {
        const list = await keyPool.list()
        // 抹掉 ciphertext
        const safe = list.map(k => ({ ...k, keyCiphertext: '' }))
        return ok(safe)
    })

    ipcMain.handle(
        'keys:add',
        async (_e, payload: { name: string; key: string; weight?: number }) => {
            if (!payload?.key) return fail('Key 不能为空', 'bad_request')
            const rec = await keyPool.add(payload)
            return ok({ ...rec, keyCiphertext: '' })
        }
    )

    ipcMain.handle('keys:remove', async (_e, payload: { id: string }) => {
        if (!payload?.id) return fail('缺少 id', 'bad_request')
        await keyPool.remove(payload.id)
        return ok(true)
    })

    ipcMain.handle('keys:setEnabled', async (_e, payload: { id: string; enabled: boolean }) => {
        if (!payload?.id) return fail('缺少 id', 'bad_request')
        await keyPool.setEnabled(payload.id, !!payload.enabled)
        return ok(true)
    })

    ipcMain.handle('keys:setWeight', async (_e, payload: { id: string; weight: number }) => {
        if (!payload?.id) return fail('缺少 id', 'bad_request')
        await keyPool.setWeight(payload.id, payload.weight)
        return ok(true)
    })

    ipcMain.handle('keys:rename', async (_e, payload: { id: string; name: string }) => {
        if (!payload?.id || !payload?.name) return fail('参数错误', 'bad_request')
        try {
            await keyPool.rename(payload.id, payload.name)
            return ok(true)
        } catch (e: any) {
            return fail(e?.message ?? 'rename failed', 'bad_request')
        }
    })

    ipcMain.handle('keys:reset', async (_e, payload: { id: string }) => {
        if (!payload?.id) return fail('缺少 id', 'bad_request')
        await keyPool.reset(payload.id)
        return ok(true)
    })

    ipcMain.handle('keys:test', async (_e, payload: { id: string }) => {
        if (!payload?.id) return fail('缺少 id', 'bad_request')
        const list = await keyPool.list()
        const rec = list.find(k => k.id === payload.id)
        if (!rec) return fail('Key 不存在', 'not_found')
        const r = await testKey(rec)
        return ok(r)
    })

    ipcMain.handle('keys:goUsage', async (_e, payload: { id: string }) => {
        if (!payload?.id) return fail('缺少 id', 'bad_request')
        const list = await keyPool.list()
        const rec = list.find(k => k.id === payload.id)
        if (!rec) return fail('Key 不存在', 'not_found')

        const resp = await fetch('https://opencode.ai/api/v1/usage/plan', {
            method: 'GET',
            headers: {
                accept: 'application/json',
                authorization: `Bearer ${keyPool.decrypt(rec)}`,
            },
        })
        if (resp.status === 404) {
            return fail('OpenCode 官方暂未开放 Go 用量 API', 'usage_api_unavailable')
        }

        const text = await safeText(resp)
        if (!resp.ok) {
            return fail(text.slice(0, 500) || `获取 OpenCode Go 用量失败：HTTP ${resp.status}`)
        }
        try {
            return ok(normalizeGoUsagePlan(JSON.parse(text)))
        } catch (e: any) {
            return fail(e?.message ?? '解析 OpenCode Go 用量失败', 'parse_error')
        }
    })

    // ---- 测试模型：临时用一个 Key 直接打上游，不走 KeyPool，但记录 Usage ----
    ipcMain.handle(
        'test:runModel',
        async (
            _e,
            payload: {
                model: string
                prompt: string
                keyId?: string
                apiKey?: string
                stream?: boolean
                maxTokens?: number
            }
        ) => {
            if (!payload?.model) return fail('缺少 model', 'bad_request')
            if (!payload?.keyId && !payload?.apiKey) return fail('请选择或输入 Key', 'bad_request')
            if (!payload?.prompt) return fail('缺少 prompt', 'bad_request')

            let apiKey = payload.apiKey ?? ''
            const keyId = payload.keyId ?? ''
            if (payload.keyId) {
                const list = await keyPool.list()
                const rec = list.find(k => k.id === payload.keyId)
                if (!rec) return fail('Key 不存在', 'not_found')
                apiKey = keyPool.decrypt(rec)
            }

            const stream = !!payload.stream
            const maxTokens = Math.max(1, Math.min(200_000, payload.maxTokens ?? 200))
            const start = Date.now()
            const requestId = randomUUID()
            const upstreamUrl = 'https://opencode.ai/zen/go/v1/chat/completions'
            const requestBody = {
                model: payload.model,
                messages: [{ role: 'user', content: payload.prompt }],
                max_tokens: maxTokens,
                stream,
            }
            const upstreamHeaders: Record<string, string> = {
                'content-type': 'application/json',
                authorization: `Bearer ${apiKey}`,
                ...(stream ? { accept: 'text/event-stream' } : {}),
            }
            const upstreamRequest = buildUpstreamRequest(
                'POST',
                upstreamUrl,
                upstreamHeaders,
                requestBody
            )

            const logTest = async (opts: {
                status: 'success' | 'failed'
                httpStatus: number
                errorMessage?: string
                upstreamResponse?: any
                inputTokens?: number
                outputTokens?: number
                cachedTokens?: number
                estimatedCost?: number
            }) => {
                const errorCode =
                    opts.status === 'failed'
                        ? opts.httpStatus === 401 || opts.httpStatus === 403
                            ? 'invalid_key'
                            : opts.httpStatus === 429
                              ? 'rate_limited'
                              : opts.httpStatus === 0
                                ? 'network_error'
                                : opts.httpStatus >= 500
                                  ? 'upstream_error'
                                  : `http_${opts.httpStatus}`
                        : undefined
                await usageTracker.record({
                    requestId,
                    keyId,
                    clientId: 'test-model',
                    model: payload.model,
                    endpoint: 'chat_completions',
                    stream,
                    inputTokens: opts.inputTokens,
                    outputTokens: opts.outputTokens,
                    cachedTokens: opts.cachedTokens,
                    estimatedCost: opts.estimatedCost,
                    status: opts.status,
                    httpStatus: opts.httpStatus,
                    errorCode,
                    errorMessage: opts.errorMessage,
                    latencyMs: Date.now() - start,
                    upstreamRequest,
                    upstreamResponse: opts.upstreamResponse,
                })
            }

            try {
                const resp = await fetch(upstreamUrl, {
                    method: 'POST',
                    headers: upstreamHeaders,
                    body: JSON.stringify(requestBody),
                })
                if (!resp.ok) {
                    const text = await safeText(resp)
                    const upstreamResponse = captureUpstreamErrorResponse(
                        resp.status,
                        resp.statusText,
                        resp.headers,
                        text
                    )
                    await logTest({
                        status: 'failed',
                        httpStatus: resp.status,
                        errorMessage: text.slice(0, 1000),
                        upstreamResponse,
                    })
                    return ok({
                        ok: false as const,
                        httpStatus: resp.status,
                        latencyMs: Date.now() - start,
                        errorMessage: text.slice(0, 1000),
                        errorBody: text,
                    })
                }
                if (!stream) {
                    const json = (await resp.json()) as any
                    const upstreamResponse = captureUpstreamJsonResponse({
                        status: resp.status,
                        statusText: resp.statusText,
                        headers: resp.headers,
                        json,
                    })
                    const usage = normalizeUsage(json?.usage)
                    const cost = usageTracker.costOf({ ...usage, model: payload.model })
                    await logTest({
                        status: 'success',
                        httpStatus: resp.status,
                        upstreamResponse,
                        inputTokens: cost.inputTokens,
                        outputTokens: cost.outputTokens,
                        cachedTokens: cost.cachedTokens,
                        estimatedCost: cost.estimatedCost,
                    })
                    return ok({
                        ok: true as const,
                        httpStatus: resp.status,
                        latencyMs: Date.now() - start,
                        json,
                    })
                }
                // 流式：把 SSE 文本整段拼回来
                const text = await resp.text()
                const upstreamResponse = captureUpstreamStreamResponse(
                    resp.status,
                    resp.statusText,
                    resp.headers,
                    text
                )
                const streamUsage = extractStreamUsage(text)
                const cost = streamUsage
                    ? usageTracker.costOf({ ...streamUsage, model: payload.model })
                    : undefined
                await logTest({
                    status: 'success',
                    httpStatus: resp.status,
                    upstreamResponse,
                    inputTokens: cost?.inputTokens,
                    outputTokens: cost?.outputTokens,
                    cachedTokens: cost?.cachedTokens,
                    estimatedCost: cost?.estimatedCost,
                })
                return ok({
                    ok: true as const,
                    httpStatus: resp.status,
                    latencyMs: Date.now() - start,
                    rawStream: text,
                })
            } catch (e: any) {
                const message = e?.message ?? String(e)
                await logTest({
                    status: 'failed',
                    httpStatus: 0,
                    errorMessage: message,
                })
                return ok({
                    ok: false as const,
                    httpStatus: 0,
                    latencyMs: Date.now() - start,
                    errorMessage: message,
                })
            }
        }
    )

    // ---- usage ----
    ipcMain.handle('usage:summary', async (_e, payload: { window: UsageWindow }) => {
        const w: UsageWindow = payload?.window ?? '5h'
        if (!['5h', '7d', '30d'].includes(w)) return fail('window 错误', 'bad_request')
        const summary: UsageSummary = await usageTracker.summary(w)
        return ok(summary)
    })

    ipcMain.handle(
        'usage:list',
        async (_e, payload: { limit?: number; model?: string; keyId?: string }) => {
            const list = await usageTracker.list(payload ?? {})
            return ok(list)
        }
    )

    ipcMain.handle('usage:detail', async (_e, payload: { id: string }) => {
        if (!payload?.id) return fail('缺少 id', 'bad_request')
        const rec = usageStore.getById(payload.id)
        if (!rec) return fail('记录不存在', 'not_found')
        return ok(rec)
    })

    // ---- gateway ----
    ipcMain.handle('gateway:status', async (): Promise<ReturnType<typeof ok<GatewayStatus>>> => {
        return ok(gatewayServer.status())
    })

    ipcMain.handle('gateway:restart', async () => {
        await gatewayServer.stop()
        await gatewayServer.start()
        refreshTrayMenu()
        return ok(true)
    })

    // ---- app ----
    ipcMain.handle('app:openDataDir', async () => {
        await shell.openPath(app.getPath('userData'))
        return ok(true)
    })
}
