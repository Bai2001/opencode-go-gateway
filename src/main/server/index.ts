import Fastify, { type FastifyInstance } from 'fastify'
import { authMiddleware, errorToResponse } from './middleware.auth'
import { registerModelsRoute } from './routes.models'
import { registerChatRoute } from './routes.chat'
import { store } from '../store/json-store'
import { openaiError } from './errors'
import type { GatewayStatus } from '../../shared/types'

/**
 * GatewayServer —— 文档 8.1
 *
 * 启动 Fastify，注册 /health, /v1/models, /v1/chat/completions。
 * 默认只监听 127.0.0.1:8910；当前版本网关允许无 Token 访问。
 */
export class GatewayServer {
    private app: FastifyInstance | null = null
    private startedAt: number | null = null

    async start(): Promise<GatewayStatus> {
        if (this.app) {
            return this.status()
        }
        const s = await store.read()
        const host = s.settings.server.host
        const port = s.settings.server.port

        const app = Fastify({
            logger: false,
            disableRequestLogging: true,
            bodyLimit: 10 * 1024 * 1024,
        })

        app.setErrorHandler((err, req, reply) => {
            const { statusCode, body } = errorToResponse(err)
            // 显式生成 requestId 写到 header
            reply.header('X-Request-Id', (req.headers['x-request-id'] as string) || '')
            reply.code(statusCode).send(body)
        })

        app.get('/health', async () => ({ status: 'ok' }))

        // auth 中间件
        app.addHook('preHandler', authMiddleware)

        await registerModelsRoute(app)
        await registerChatRoute(app)

        // 兜底 404 转 OpenAI 错误
        app.setNotFoundHandler((req, reply) => {
            reply
                .code(404)
                .send(
                    openaiError(
                        `Not found: ${req.method} ${req.url}`,
                        'invalid_request_error',
                        'not_found'
                    )
                )
        })

        try {
            await app.listen({ port, host })
        } catch (e: any) {
            throw new Error(`网关启动失败：${e?.message ?? e}`)
        }
        this.app = app
        this.startedAt = Date.now()
        return this.status()
    }

    async stop(): Promise<void> {
        if (!this.app) return
        await this.app.close()
        this.app = null
        this.startedAt = null
    }

    status(): GatewayStatus {
        const s = store.cache!
        return {
            running: !!this.app,
            host: s.settings.server.host,
            port: s.settings.server.port,
            requireToken: !!s.settings.auth.gatewayTokenHash,
            startedAt: this.startedAt ?? undefined,
            upstreamUrl: 'https://opencode.ai/zen/go/v1',
        }
    }
}

export const gatewayServer = new GatewayServer()
