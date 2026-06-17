/**
 * OpenAI 风格的错误响应 + Fastify 错误处理。
 */

export type OpenAIError = {
    error: {
        message: string
        type: string
        param?: string | null
        code?: string | null
    }
}

export function openaiError(
    message: string,
    type: string,
    code?: string,
    param?: string | null
): OpenAIError {
    return {
        error: {
            message,
            type,
            code: code ?? null,
            param: param ?? null,
        },
    }
}

export class HttpError extends Error {
    statusCode: number
    type: string
    code?: string
    constructor(statusCode: number, message: string, type: string, code?: string) {
        super(message)
        this.statusCode = statusCode
        this.type = type
        this.code = code
    }
}
