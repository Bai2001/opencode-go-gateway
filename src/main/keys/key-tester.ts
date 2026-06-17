import { MODEL_REGISTRY } from '../../shared/models'
import type { ApiKeyRecord } from '../../shared/types'
import { cryptoService } from '../security/crypto-service'

/**
 * KeyTester —— 用一个超轻量请求验证 Key 是否有效。
 *
 * 实现：
 *  - 用 deepseek-v4-flash 这个最便宜的模型发一个最小非流式请求
 *  - 200 -> ok
 *  - 401/403 -> invalid
 *  - 429 / 5xx -> 临时不可用
 *  - 其他 -> unknown
 *
 * 返回值直接给 UI 展示，不修改 Key 状态（由调用方决定）。
 */
export type KeyTestResult = {
    ok: boolean
    httpStatus: number
    latencyMs: number
    errorCode?: string
    errorMessage?: string
}

const TEST_MODEL = 'deepseek-v4-flash'

export async function testKey(rec: ApiKeyRecord): Promise<KeyTestResult> {
    const model = MODEL_REGISTRY[TEST_MODEL]
    const url = model.upstreamUrl
    const key = cryptoService.decrypt(rec.keyCiphertext)
    const start = Date.now()
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
                model: TEST_MODEL,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
                stream: false,
            }),
        })
        const latencyMs = Date.now() - start
        if (resp.ok) {
            return { ok: true, httpStatus: resp.status, latencyMs }
        }
        const text = await safeText(resp)
        return {
            ok: false,
            httpStatus: resp.status,
            latencyMs,
            errorCode: classify(resp.status),
            errorMessage: text.slice(0, 200),
        }
    } catch (e: any) {
        return {
            ok: false,
            httpStatus: 0,
            latencyMs: Date.now() - start,
            errorCode: 'network_error',
            errorMessage: e?.message ?? String(e),
        }
    }
}

function classify(status: number): string {
    if (status === 401 || status === 403) return 'invalid'
    if (status === 429) return 'rate_limited'
    if (status >= 500) return 'upstream_error'
    return 'http_error'
}

async function safeText(resp: Response): Promise<string> {
    try {
        return await resp.text()
    } catch {
        return ''
    }
}
