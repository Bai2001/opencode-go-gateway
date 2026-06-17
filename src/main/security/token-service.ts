import { createHash, randomBytes } from 'node:crypto'

/**
 * Gateway 客户端 Token 的生成 / 校验。
 *
 * 设计：
 *  - Token 明文只在用户添加/重置时出现一次，Main Process 立刻 hash 后丢弃
 *  - 存盘的是 sha256(token + salt)
 *  - V1 只支持一个全局 Gateway Token，client_tokens 表留给 V2
 */
export class TokenService {
    private static readonly SALT = 'opencode-go-gateway:client-token:v1'

    /** 生成一个用户可读的 Token 字符串 */
    static generate(): string {
        return 'gw_' + randomBytes(24).toString('base64url')
    }

    /** 把明文 Token 变成存盘用的 hash */
    static hash(token: string): string {
        return createHash('sha256')
            .update(this.SALT + token)
            .digest('hex')
    }

    /** 校验明文是否对得上存盘的 hash */
    static verify(token: string, hash: string): boolean {
        if (!token || !hash) return false
        const got = this.hash(token)
        if (got.length !== hash.length) return false
        // 常数时间比较
        let r = 0
        for (let i = 0; i < got.length; i++) r |= got.charCodeAt(i) ^ hash.charCodeAt(i)
        return r === 0
    }
}
