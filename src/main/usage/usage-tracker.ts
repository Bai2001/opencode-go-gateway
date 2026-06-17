import { randomUUID } from 'node:crypto'
import type { UsageRecord, UsageSummary, UsageWindow } from '../../shared/types'
import { store } from '../store/json-store'
import { estimateCost, roughTokensFromText, type ModelRates } from './cost-estimator'

/**
 * UsageTracker —— 文档 8.8
 *
 * 记录每次请求的：
 *   模型、Key、客户端、耗时、状态、tokens、估算成本
 *
 * V1 来源优先级：
 *   1. 上游响应 usage 字段
 *   2. 流式时累加的 text delta
 *   3. 实在拿不到就 char 粗估
 *
 * 日志裁剪：
 *   每次 record 后异步裁剪超过 retentionDays 的记录。
 */

const WINDOW_MS: Record<UsageWindow, number> = {
    '5h': 5 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
}

class UsageTracker {
    /** 创建并落盘一条 usage 记录。返回 record id。 */
    async record(
        input: Omit<UsageRecord, 'id' | 'createdAt'> & { createdAt?: number }
    ): Promise<string> {
        const id = randomUUID()
        const rec: UsageRecord = {
            id,
            createdAt: input.createdAt ?? Date.now(),
            ...input,
        }
        await store.update(s => {
            s.usage.push(rec)
        })
        // 异步裁剪，不要阻塞请求
        setImmediate(() => {
            this.prune().catch(() => {
                /* ignore */
            })
        })
        return id
    }

    /** 更新一条已有 usage 记录（流式结束后补 usage） */
    async patch(id: string, patch: Partial<UsageRecord>): Promise<void> {
        await store.update(s => {
            const r = s.usage.find(x => x.id === id)
            if (r) Object.assign(r, patch)
        })
    }

    async list(
        opts: { limit?: number; model?: string; keyId?: string } = {}
    ): Promise<UsageRecord[]> {
        const s = await store.read()
        let arr = s.usage
        if (opts.model) arr = arr.filter(r => r.model === opts.model)
        if (opts.keyId) arr = arr.filter(r => r.keyId === opts.keyId)
        arr = arr.slice().sort((a, b) => b.createdAt - a.createdAt)
        if (opts.limit) arr = arr.slice(0, opts.limit)
        return arr
    }

    async summary(window: UsageWindow): Promise<UsageSummary> {
        const since = Date.now() - WINDOW_MS[window]
        const s = await store.read()
        const records = s.usage.filter(r => r.createdAt >= since)
        const byKeyMap = new Map<
            string,
            { keyId: string; keyPreview: string; requests: number; estimatedCost: number }
        >()
        const byModelMap = new Map<
            string,
            { model: string; requests: number; estimatedCost: number }
        >()

        let totalInput = 0
        let totalOutput = 0
        let totalCached = 0
        let totalCost = 0
        let success = 0
        let failed = 0

        for (const r of records) {
            if (r.status === 'success') success++
            else if (r.status === 'failed') failed++
            totalInput += r.inputTokens ?? 0
            totalOutput += r.outputTokens ?? 0
            totalCached += r.cachedTokens ?? 0
            totalCost += r.estimatedCost ?? 0

            const k = byKeyMap.get(r.keyId) ?? {
                keyId: r.keyId,
                keyPreview: r.keyId ? previewFor(s.keys, r.keyId) : '?',
                requests: 0,
                estimatedCost: 0,
            }
            k.requests += 1
            k.estimatedCost += r.estimatedCost ?? 0
            byKeyMap.set(r.keyId, k)

            const m = byModelMap.get(r.model) ?? { model: r.model, requests: 0, estimatedCost: 0 }
            m.requests += 1
            m.estimatedCost += r.estimatedCost ?? 0
            byModelMap.set(r.model, m)
        }

        return {
            totalRequests: records.length,
            successRequests: success,
            failedRequests: failed,
            totalInputTokens: totalInput,
            totalOutputTokens: totalOutput,
            totalCachedTokens: totalCached,
            estimatedCost: round(totalCost),
            byKey: Array.from(byKeyMap.values()).map(k => ({
                ...k,
                estimatedCost: round(k.estimatedCost),
            })),
            byModel: Array.from(byModelMap.values()).map(m => ({
                ...m,
                estimatedCost: round(m.estimatedCost),
            })),
        }
    }

    /** 裁剪超过 retentionDays 的记录 */
    async prune(): Promise<void> {
        const s = await store.read()
        const days = s.settings.log?.retentionDays ?? 30
        if (days <= 0) return
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
        const before = s.usage.length
        s.usage = s.usage.filter(r => r.createdAt >= cutoff)
        if (s.usage.length !== before) {
            // store.update 的语义是 mutate 后 flush
            await store.update(cur => {
                cur.usage = s.usage
            })
        }
    }

    /** 把上游 usage 字段折算成本估算 */
    costOf(opts: {
        inputTokens?: number
        outputTokens?: number
        cachedTokens?: number
        model?: string
    }) {
        return estimateCost({ ...opts, rates: this.buildRatesFromStore() })
    }

    /** 从 store 中的内置覆盖与自定义模型提取价格表 */
    private buildRatesFromStore(): Record<string, ModelRates> | undefined {
        const s = store.cache?.settings.models
        if (!s) return undefined
        const rates: Record<string, ModelRates> = {}
        for (const [id, route] of Object.entries(s.builtInOverrides ?? {})) {
            if (
                route.inputPrice != null &&
                route.outputPrice != null &&
                route.cachedPrice != null
            ) {
                rates[id] = {
                    input: route.inputPrice,
                    output: route.outputPrice,
                    cached: route.cachedPrice,
                }
            }
        }
        for (const [id, route] of Object.entries(s.custom ?? {})) {
            if (
                route.inputPrice != null &&
                route.outputPrice != null &&
                route.cachedPrice != null &&
                !rates[id]
            ) {
                rates[id] = {
                    input: route.inputPrice,
                    output: route.outputPrice,
                    cached: route.cachedPrice,
                }
            }
        }
        return Object.keys(rates).length > 0 ? rates : undefined
    }

    /** 用字符粗估 token（兜底） */
    roughTokens(text?: string | null) {
        return roughTokensFromText(text)
    }
}

function previewFor(keys: Array<{ id: string; keyPreview: string }>, id: string): string {
    const k = keys.find(x => x.id === id)
    return k?.keyPreview ?? '(已删除)'
}

function round(n: number): number {
    return Math.round(n * 1_000_000) / 1_000_000
}

export const usageTracker = new UsageTracker()
