import { randomUUID } from 'node:crypto'
import type { ApiKeyRecord, KeyStatus, UsageRecord } from '../../shared/types'
import { store } from '../store/json-store'
import { cryptoService } from '../security/crypto-service'
import { keySelector } from './key-selector'

/**
 * KeyPoolManager —— 负责多 Key 增删改查 + 状态变更。
 *
 * 状态机：
 *   active <-> cooldown
 *   active -> disabled (人工)
 *   active -> invalid  (401/403)
 *   active -> exhausted(持续 429)
 *
 * 设计要点：
 *  - 所有 Key 记录都从 LocalStore 读出 / 写回
 *  - 明文 Key 仅在 add / test 时短暂出现，其他场景只持有密文
 *  - Renderer 拿到的 Key 永远只有 preview，没有 ciphertext / 明文
 */
export class KeyPoolManager {
    private listeners = new Set<() => void>()

    onChange(listener: () => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    private emit() {
        for (const fn of this.listeners) {
            try {
                fn()
            } catch {
                /* ignore */
            }
        }
    }

    async list(): Promise<ApiKeyRecord[]> {
        const s = await store.read()
        return s.keys
    }

    async add(payload: { name: string; key: string; weight?: number }): Promise<ApiKeyRecord> {
        const name = payload.name.trim() || '未命名 Key'
        const plain = payload.key.trim()
        if (!plain) throw new Error('Key 不能为空')
        const now = Date.now()
        const rec: ApiKeyRecord = {
            id: randomUUID(),
            name,
            keyCiphertext: cryptoService.encrypt(plain),
            keyPreview: cryptoService.preview(plain),
            enabled: true,
            weight: Math.max(1, Math.min(10, payload.weight ?? 1)),
            status: 'active',
            errorCount: 0,
            createdAt: now,
            updatedAt: now,
        }
        await store.update(s => {
            s.keys.push(rec)
        })
        this.emit()
        return rec
    }

    async remove(id: string): Promise<void> {
        await store.update(s => {
            s.keys = s.keys.filter(k => k.id !== id)
        })
        this.emit()
    }

    async setEnabled(id: string, enabled: boolean): Promise<void> {
        await store.update(s => {
            const k = s.keys.find(x => x.id === id)
            if (k) {
                k.enabled = enabled
                k.status = enabled ? (k.status === 'invalid' ? 'disabled' : k.status) : 'disabled'
                k.updatedAt = Date.now()
            }
        })
        this.emit()
    }

    async setWeight(id: string, weight: number): Promise<void> {
        const w = Math.max(1, Math.min(10, Math.floor(weight)))
        await store.update(s => {
            const k = s.keys.find(x => x.id === id)
            if (k) {
                k.weight = w
                k.updatedAt = Date.now()
            }
        })
        this.emit()
    }

    async rename(id: string, name: string): Promise<void> {
        const trimmed = name.trim()
        if (!trimmed) throw new Error('名称不能为空')
        await store.update(s => {
            const k = s.keys.find(x => x.id === id)
            if (k) {
                k.name = trimmed
                k.updatedAt = Date.now()
            }
        })
        this.emit()
    }

    /** 选择一个 Key 给 UpstreamClient 用（不解密 ciphertext） */
    async select(usage: UsageRecord[]): Promise<ApiKeyRecord | null> {
        const s = await store.read()
        return keySelector.select(s.keys, usage)
    }

    /** 解密 Key 明文（只在调用 UpstreamClient 时使用，绝不外发） */
    decrypt(rec: ApiKeyRecord): string {
        return cryptoService.decrypt(rec.keyCiphertext)
    }

    /** 标记 Key 成功 */
    async markSuccess(id: string): Promise<void> {
        await store.update(s => {
            const k = s.keys.find(x => x.id === id)
            if (k) {
                k.errorCount = 0
                k.status = 'active'
                k.cooldownUntil = undefined
                k.lastUsedAt = Date.now()
                k.updatedAt = Date.now()
            }
        })
        this.emit()
    }

    /**
     * 标记 Key 失败。
     * status 由 status 字段决定如何转换：
     *   401/403 -> invalid
     *   429     -> cooldown 或 exhausted
     *   5xx     -> cooldown（短）
     *   网络错误 -> cooldown（短）
     */
    async markFailure(
        id: string,
        info: { httpStatus?: number; errorCode?: string; message?: string }
    ): Promise<{ nextStatus: KeyStatus; cooldownMs: number }> {
        const status = info.httpStatus ?? 0
        let nextStatus: KeyStatus = 'cooldown'
        let cooldownMs = 30_000

        if (status === 401 || status === 403) {
            nextStatus = 'invalid'
            cooldownMs = 0
        } else if (status === 429) {
            nextStatus = 'cooldown'
            cooldownMs = 60_000
        } else if (status >= 500 || status === 0) {
            nextStatus = 'cooldown'
            cooldownMs = 15_000
        } else if (status === 408) {
            nextStatus = 'cooldown'
            cooldownMs = 10_000
        } else {
            nextStatus = 'cooldown'
            cooldownMs = 5_000
        }

        await store.update(s => {
            const k = s.keys.find(x => x.id === id)
            if (k) {
                k.errorCount += 1
                k.status = nextStatus
                k.cooldownUntil = cooldownMs > 0 ? Date.now() + cooldownMs : undefined
                // 连续 5 次 429 标记为 exhausted
                if (k.errorCount >= 5 && nextStatus === 'cooldown') {
                    k.status = 'exhausted'
                    k.cooldownUntil = Date.now() + 5 * 60_000
                }
                // invalid 状态自动 disabled
                if (nextStatus === 'invalid') {
                    k.enabled = false
                }
                k.updatedAt = Date.now()
            }
        })
        this.emit()
        return { nextStatus, cooldownMs }
    }

    /** 重置一个 Key（清除冷却 / 错误计数 / 重新启用） */
    async reset(id: string): Promise<void> {
        await store.update(s => {
            const k = s.keys.find(x => x.id === id)
            if (k) {
                k.status = 'active'
                k.errorCount = 0
                k.cooldownUntil = undefined
                k.enabled = true
                k.updatedAt = Date.now()
            }
        })
        this.emit()
    }
}

export const keyPool = new KeyPoolManager()
