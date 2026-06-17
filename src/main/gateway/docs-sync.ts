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

    // 1. 解析 API 端点表格：模型名、模型 ID（忽略上游 URL）
    const endpointRows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []
    const modelIds = new Set<string>()

    for (const row of endpointRows) {
        const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []
        if (cells.length < 2) continue
        const idRaw = cells[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
        if (!idRaw) continue
        modelIds.add(normalizeModelId(idRaw))
    }

    // 2. 解析价格表格：模型名、input、output、cached（第 5 列为其他费用，忽略）
    const priceRows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []
    for (const row of priceRows) {
        const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []
        if (cells.length < 4) continue
        // 只处理包含 $ 符号的价格行；跳过长上下文分档行（取默认档 ≤256K）
        if (!cells.some(c => c.includes('$'))) continue
        const name = cells[0]?.replace(/<[^>]+>/g, '').trim() ?? ''
        if (name.includes('>') || name.includes('＞')) continue
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
