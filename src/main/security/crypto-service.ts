import { app, safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * 加密保存 OpenCode Go Key。
 *
 * 策略：
 *  - 优先使用 Electron safeStorage（Windows DPAPI / macOS Keychain / Linux Secret Service）
 *  - 不可用时回退到 AES-256-GCM + 派生 key（仍然 OK，但弱于系统密钥库）
 *  - 明文永远只在 Main Process 内存中存在
 */
export class CryptoService {
    private fallbackKey: Buffer | null = null

    isSystemBackendAvailable(): boolean {
        try {
            return safeStorage.isEncryptionAvailable()
        } catch {
            return false
        }
    }

    /** 加密一个明文字符串，返回 base64 字符串。 */
    encrypt(plain: string): string {
        if (this.isSystemBackendAvailable()) {
            return 'safe:' + safeStorage.encryptString(plain).toString('base64')
        }
        return 'aes:' + this.aesEncrypt(plain)
    }

    /** 解密 base64 字符串，返回明文。 */
    decrypt(payload: string): string {
        if (payload.startsWith('safe:')) {
            if (!this.isSystemBackendAvailable()) {
                throw new Error('safeStorage 不可用，无法解密历史 Key')
            }
            return safeStorage.decryptString(Buffer.from(payload.slice(5), 'base64'))
        }
        if (payload.startsWith('aes:')) {
            return this.aesDecrypt(payload.slice(4))
        }
        throw new Error('未知的加密前缀')
    }

    /**
     * 把一个 Key 字符串转成 `sk-abc1********6789` 这种脱敏预览。
     * 长度不足 8 时直接显示 ***。
     */
    preview(plain: string): string {
        if (plain.length <= 8) return '***'
        return plain.slice(0, 4) + '********' + plain.slice(-4)
    }

    private getFallbackKey(): Buffer {
        if (this.fallbackKey) return this.fallbackKey
        // 用 app 的固定 salt + 用户名派生一个 key
        const salt = Buffer.from('opencode-go-gateway:v1', 'utf8')
        const seed = app.getPath('userData')
        this.fallbackKey = scryptSync(seed, salt, 32)
        return this.fallbackKey
    }

    private aesEncrypt(plain: string): string {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', this.getFallbackKey(), iv)
        const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
        const tag = cipher.getAuthTag()
        return Buffer.concat([iv, tag, enc]).toString('base64')
    }

    private aesDecrypt(payload: string): string {
        const buf = Buffer.from(payload, 'base64')
        const iv = buf.subarray(0, 12)
        const tag = buf.subarray(12, 28)
        const enc = buf.subarray(28)
        const decipher = createDecipheriv('aes-256-gcm', this.getFallbackKey(), iv)
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
    }
}

export const cryptoService = new CryptoService()
