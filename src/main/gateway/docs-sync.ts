/**
 * 从 OpenCode Go 官方文档同步模型列表与价格。
 *
 * 解析 https://opencode.ai/docs/zh-cn/go 页面中的表格，
 * 提取模型 ID 与每 1M tokens 价格（input / output / cached）。
 * 上游 URL 保持内置默认值，不同步覆盖。
 */

const DOCS_URL = 'https://opencode.ai/docs/zh-cn/go'

export type ModelPriceInfo = {
    id: string
    input: number
    output: number
    cached: number
}

function normalizeModelId(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9.-]/g, '')
}

function parsePrice(text: string): number {
    const m = text.match(/\$?([\d.]+)/)
    if (!m) return 0
    return parseFloat(m[1])
}

/** 抓取并解析文档 */
export async function syncModelsFromDocs(): Promise<{
    models: ModelPriceInfo[]
    prices: Record<string, { input: number; output: number; cached: number }>
}> {
    const res = await fetch(DOCS_URL, {
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0',
        },
    })
    if (!res.ok) {
        throw new Error(`获取文档失败：${res.status} ${res.statusText}`)
    }
    const html = await res.text()

    const models: ModelPriceInfo[] = []
    const prices: Record<string, { input: number; output: number; cached: number }> = {}

    // 1. 解析 API 端点表格：只处理包含 opencode.ai/zen/go 上游 URL 的行
    //    （避免误把"使用限制请求数表"等数字行当成模型 ID）
    const endpointRows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []
    const modelIds = new Set<string>()

    for (const row of endpointRows) {
        if (!row.includes('opencode.ai/zen/go')) continue
        const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []
        if (cells.length < 2) continue
        const idRaw = cells[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
        if (!idRaw) continue
        if (/^\d+$/.test(idRaw)) continue
        modelIds.add(normalizeModelId(idRaw))
    }

    // 2. 解析价格表格：只处理含 $ 的行，且模型名必须包含字母
    const priceRows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []
    for (const row of priceRows) {
        const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []
        if (cells.length < 4) continue
        if (!cells.some(c => c.includes('$'))) continue
        const name = cells[0]?.replace(/<[^>]+>/g, '').trim() ?? ''
        if (!name) continue
        // 跳过长上下文分档行（> 256K tokens），保留默认档（≤ 256K tokens）
        if (name.includes('>') || name.includes('＞')) continue
        // 跳过纯数字/纯符号行（使用限制请求数表等）
        if (!/[a-zA-Z]/.test(name)) continue
        const input = parsePrice(cells[1] ?? '')
        const output = parsePrice(cells[2] ?? '')
        const cached = parsePrice(cells[3] ?? '')
        if (!name || (input === 0 && output === 0)) continue

        // 去掉模型名中的分档后缀，尽量对齐 endpoint id
        const cleanName = name
            .replace(/\s*\([^)]*\)/g, '')
            .replace(/\s+/g, ' ')
            .trim()
        const key = normalizeModelId(cleanName)
        prices[key] = { input, output, cached }

        if (modelIds.has(key)) {
            models.push({ id: key, input, output, cached })
        }
    }

    // 3. 兜底：endpoint 表格有但价格表没有，按零价格加入模型列表
    for (const id of modelIds) {
        if (!models.some(m => m.id === id)) {
            const matched = Array.from(Object.keys(prices)).find(
                k => id.includes(k) || k.includes(id)
            )
            const rate = matched ? prices[matched] : { input: 0, output: 0, cached: 0 }
            models.push({ id, ...rate })
        }
    }

    return { models, prices }
}

/**
 * 高层同步：抓取文档 -> 写入 store.builtInOverrides -> 触发 router reload。
 *
 * 供 IPC `models:syncFromDocs` 和启动时自动同步共用。
 *
 * @param opts.silent 抓取失败时只记录日志、不抛错（启动场景用 true）
 * @returns 同步到的模型列表；silent 模式下失败返回空数组
 */
export async function syncModelsToStore(opts: { silent?: boolean } = {}): Promise<ModelPriceInfo[]> {
    let models: ModelPriceInfo[]
    try {
        const r = await syncModelsFromDocs()
        models = r.models
    } catch (e: any) {
        const msg = e?.message ?? e
        if (opts.silent) {
            console.error('[docs-sync] 启动同步失败，保留现有模型配置：', msg)
            return []
        }
        throw e
    }
    if (models.length === 0) {
        if (opts.silent) {
            console.warn('[docs-sync] 未从文档解析到模型，保留现有配置')
            return []
        }
        throw new Error('未从文档解析到模型')
    }

    // 延迟引入，避免循环依赖（store <-> docs-sync）
    const { store } = await import('../store/json-store')
    const { DEFAULT_GO_UPSTREAM_URL } = await import('../../shared/models')
    const { modelRouter } = await import('./model-router')

    const synced: ModelPriceInfo[] = []
    await store.update(s => {
        // 清理历史同步产生的数字垃圾条目（如 880、3250、1.40 等）
        for (const id of Object.keys(s.settings.models.builtInOverrides ?? {})) {
            if (/^\d+(\.\d+)?$/.test(id)) {
                delete s.settings.models.builtInOverrides[id]
            }
        }
        for (const m of models) {
            const existing = s.settings.models.builtInOverrides[m.id]
            // 已有自定义 upstreamUrl（用户手动改过）则保留，否则用默认上游
            const upstreamUrl = existing?.upstreamUrl ?? DEFAULT_GO_UPSTREAM_URL
            s.settings.models.builtInOverrides[m.id] = {
                upstreamUrl,
                enabled: existing?.enabled ?? true,
                inputPrice: m.input,
                outputPrice: m.output,
                cachedPrice: m.cached,
            }
            synced.push(m)
        }
    })
    modelRouter.reload()
    return synced
}
