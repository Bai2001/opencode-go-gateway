import { MODEL_REGISTRY } from '../../shared/models'
import { store } from '../store/json-store'
import type { ModelRoute, ModelRegistry } from '../../shared/types'

/**
 * ModelRouter —— 文档 8.3
 *
 * 经过 OpenCode Go 实际探测验证：
 *  - /v1/chat/completions 同时支持 OpenAI-compatible 模型和 minimax/qwen 系列
 *  - 鉴权一律用 `Authorization: Bearer <key>`
 *  - 全部走 OpenAI Chat Completions 协议，**不需要**做协议转换
 *
 * 因此本类只关心：模型是否支持，对应 upstream URL 是多少。
 * V2 支持从 Store 加载自定义模型与启停配置。
 */
class ModelRouter {
    private builtIn: ModelRegistry = MODEL_REGISTRY
    private registry: ModelRegistry = {}
    private disabled = new Set<string>()

    /** 从当前 store 快照重建生效的模型表 */
    reload() {
        const s = store.cache?.settings.models ?? {
            builtInOverrides: {},
            custom: {},
            disabled: [],
        }
        const merged: ModelRegistry = Object.fromEntries(
            Object.entries(this.builtIn).map(([id, route]) => {
                const override = s.builtInOverrides?.[id]
                return [
                    id,
                    {
                        ...route,
                        upstreamUrl: override?.upstreamUrl || route.upstreamUrl,
                        enabled: override?.enabled ?? route.enabled,
                        inputPrice: override?.inputPrice ?? route.inputPrice,
                        outputPrice: override?.outputPrice ?? route.outputPrice,
                        cachedPrice: override?.cachedPrice ?? route.cachedPrice,
                    },
                ]
            })
        )
        for (const [id, route] of Object.entries(s.custom ?? {})) {
            if (id.trim()) merged[id] = route
        }
        const disabled = new Set((s.disabled ?? []).filter(id => id.trim()))
        this.disabled = disabled
        this.registry = Object.fromEntries(
            Object.entries(merged).filter(([id]) => !disabled.has(id))
        )
    }

    isSupported(model: string): boolean {
        return Object.prototype.hasOwnProperty.call(this.registry, model)
    }

    resolve(model: string): ModelRoute {
        const r = this.registry[model]
        if (!r) throw new Error(`不支持的模型：${model}`)
        return r
    }

    listModelIds(): string[] {
        return Object.keys(this.registry)
    }

    /** 返回完整视图：包含内置、自定义以及各自启用状态 */
    listAll(): Array<{
        id: string
        upstreamUrl: string
        source: 'built-in' | 'custom'
        enabled: boolean
        inputPrice?: number
        outputPrice?: number
        cachedPrice?: number
    }> {
        const s = store.cache?.settings.models ?? {
            builtInOverrides: {},
            custom: {},
            disabled: [],
        }
        const disabled = new Set(s.disabled ?? [])
        const builtIn = Object.entries(this.builtIn).map(([id, route]) => {
            const override = s.builtInOverrides?.[id]
            return {
                id,
                upstreamUrl: override?.upstreamUrl || route.upstreamUrl,
                source: 'built-in' as const,
                enabled: !disabled.has(id),
                inputPrice: override?.inputPrice ?? route.inputPrice,
                outputPrice: override?.outputPrice ?? route.outputPrice,
                cachedPrice: override?.cachedPrice ?? route.cachedPrice,
            }
        })
        const custom = Object.entries(s.custom ?? {}).map(([id, route]) => ({
            id,
            upstreamUrl: route.upstreamUrl,
            source: 'custom' as const,
            enabled: !disabled.has(id),
            inputPrice: route.inputPrice,
            outputPrice: route.outputPrice,
            cachedPrice: route.cachedPrice,
        }))
        return [...builtIn, ...custom]
    }
}

export const modelRouter = new ModelRouter()
