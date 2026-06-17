import type { FastifyReply, FastifyRequest } from 'fastify'
import { TokenService } from '../security/token-service'
import { store } from '../store/json-store'
import { HttpError, openaiError } from './errors'

/**
 * AuthMiddleware —— 文档 8.2
 *
 * 校验客户端传入的 `Authorization: Bearer xxx`。
 *
 * 规则：
 *  - 如果 settings.auth.gatewayTokenHash 为空，则允许无 Token 访问
 *  - 否则必须传 token，并与 gatewayTokenHash 常数时间比较
 */
export async function authMiddleware(req: FastifyRequest, _reply: FastifyReply) {
    const s = await store.read()
    // 未设置 Token 时允许无 Token 访问
    if (!s.settings.auth.gatewayTokenHash) return

    const header = req.headers.authorization
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
        throw new HttpError(
            401,
            '缺少 Authorization 头',
            'invalid_request_error',
            'missing_authorization'
        )
    }
    const token = header.slice(7).trim()
    if (!token) {
        throw new HttpError(
            401,
            'Authorization token 为空',
            'invalid_request_error',
            'missing_authorization'
        )
    }
    if (!TokenService.verify(token, s.settings.auth.gatewayTokenHash)) {
        throw new HttpError(401, 'Token 错误', 'invalid_request_error', 'invalid_gateway_token')
    }
}

/** 把 HttpError 序列化为 OpenAI 错误 JSON */
export function errorToResponse(err: unknown): {
    statusCode: number
    body: ReturnType<typeof openaiError>
} {
    if (err instanceof HttpError) {
        return {
            statusCode: err.statusCode,
            body: openaiError(err.message, err.type, err.code),
        }
    }
    const e = err as any
    return {
        statusCode: 500,
        body: openaiError(e?.message ?? 'Internal Server Error', 'server_error', 'internal_error'),
    }
}
