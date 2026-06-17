import type { ApiKeyRecord, UsageRecord } from '../../shared/types'

/**
 * KeySelector —— 文档 8.5 / 12.1
 *
 * 评分公式（V1 简化版，V2 可加 5h/7d/30d 成本权重）：
 *
 *   score = weight * 10
 *         + idleSeconds(lastUsedAt) * 0.05
 *         - errorCount * 5
 *         - (isCooldown ? 1000 : 0)
 *
 * 过滤条件：
 *   enabled === true
 *   status === 'active'
 *   cooldownUntil < now
 */
class KeySelector {
    select(keys: ApiKeyRecord[], _usage: UsageRecord[]): ApiKeyRecord | null {
        const now = Date.now()
        const candidates = keys.filter(k => {
            if (!k.enabled) return false
            if (k.status === 'invalid' || k.status === 'disabled' || k.status === 'exhausted')
                return false
            if (k.status === 'cooldown' && k.cooldownUntil && k.cooldownUntil > now) return false
            return true
        })
        if (candidates.length === 0) return null

        let best: ApiKeyRecord | null = null
        let bestScore = -Infinity
        for (const k of candidates) {
            const idle = k.lastUsedAt ? (now - k.lastUsedAt) / 1000 : 3600
            const score =
                k.weight * 10 +
                Math.min(idle, 3600) * 0.05 -
                k.errorCount * 5 -
                (k.status === 'cooldown' ? 50 : 0)
            if (score > bestScore) {
                best = k
                bestScore = score
            }
        }
        return best
    }
}

export const keySelector = new KeySelector()
