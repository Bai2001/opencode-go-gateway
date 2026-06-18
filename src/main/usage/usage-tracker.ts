import { randomUUID } from 'node:crypto'
import type { UsageRecord, UsageSummary, UsageWindow } from '../../shared/types'
import { store } from '../store/json-store'
import { usageStore, WINDOW_MS } from '../store/usage-store'
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
 * 存储介质：SQLite（usage.db）。详见 usage-store.ts。
 *
 * 日志裁剪：
 *   每次 record 后异步裁剪超过 retentionDays 的记录。
 */

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
        usageStore.insert(rec)
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
        usageStore.patch(id, patch)
    }

    async list(
        opts: { limit?: number; model?: string; keyId?: string } = {}
    ): Promise<UsageRecord[]> {
        return usageStore.list(opts)
    }

    async summary(window: UsageWindow): Promise<UsageSummary> {
        const since = Date.now() - WINDOW_MS[window]
        const s = await store.read()
        return usageStore.aggregateSince(since, s.keys)
    }

    /** 裁剪超过 retentionDays 的记录 */
    async prune(): Promise<void> {
        const s = await store.read()
        const days = s.settings.log?.retentionDays ?? 30
        if (days <= 0) return
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
        usageStore.pruneBefore(cutoff)
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

export const usageTracker = new UsageTracker()
