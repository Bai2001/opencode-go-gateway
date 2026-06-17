import type { FastifyInstance } from 'fastify'
import { modelRouter } from '../gateway/model-router'

/**
 * GET /v1/models —— 文档 6.1
 *
 * 返回 OpenAI 风格模型列表。本地写死即可（V2 再考虑同步上游）。
 */
export async function registerModelsRoute(app: FastifyInstance) {
    app.get('/v1/models', async () => {
        const now = Math.floor(Date.now() / 1000)
        const data = modelRouter.listModelIds().map(id => ({
            id,
            object: 'model',
            created: now,
            owned_by: 'opencode-go',
        }))
        return { object: 'list', data }
    })
}
