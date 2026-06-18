import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
    ApiKeyRecord,
    AppSettings,
    ClientToken,
    ModelConfig,
    UsageRecord,
} from '../../shared/types'

/**
 * V1 选用的存储：单个 JSON 文件 + 原子写入。
 *
 * 文件路径遵循文档 13.1：
 *   Windows: %APPDATA%/opencode-go-gateway/config.json
 *   macOS:   ~/Library/Application Support/opencode-go-gateway/config.json
 *   Linux:   ~/.config/opencode-go-gateway/config.json
 *
 * Electron app.getPath('userData') 已经按平台正确处理了上面的路径。
 */

export type StoreShape = {
    settings: AppSettings
    keys: ApiKeyRecord[]
    /**
     * 已废弃：usage 数据已迁移到 SQLite（usage.db）。
     * 此字段仅在启动迁移时用于读取旧版 config.json 中残留的记录，
     * 迁移完成后会被清空。新代码请使用 usageStore。
     */
    usage?: UsageRecord[]
    clientTokens: ClientToken[]
    /** 持久化的当前 Gateway Token（明文），仅用于进程重启后不需要用户重设 */
    gatewayTokenPlain?: string
}

const DEFAULT_MODEL_CONFIG: ModelConfig = {
    builtInOverrides: {},
    custom: {},
    disabled: [],
}

const DEFAULT_SETTINGS: AppSettings = {
    server: {
        host: '127.0.0.1',
        port: 8910,
        enableLanAccess: false,
    },
    auth: {
        requireGatewayToken: false,
        gatewayTokenHash: '',
    },
    startup: {
        launchAtLogin: false,
        startMinimized: false,
    },
    log: {
        retentionDays: 30,
    },
    models: DEFAULT_MODEL_CONFIG,
}

export class JsonStore {
    private filePath: string
    /** 同步可读的内存快照。仅当 load() 之后才非空。 */
    cache: StoreShape | null = null
    private writeQueue: Promise<void> = Promise.resolve()

    constructor(fileName = 'config.json') {
        this.filePath = join(app.getPath('userData'), fileName)
    }

    get path() {
        return this.filePath
    }

    async load(): Promise<StoreShape> {
        if (this.cache) return this.cache
        try {
            const raw = await fs.readFile(this.filePath, 'utf8')
            const parsed = JSON.parse(raw) as Partial<StoreShape>
            this.cache = this.normalize(parsed)
        } catch (err: any) {
            if (err.code !== 'ENOENT') {
                // 文件损坏时不要丢用户数据；备份并重置
                try {
                    await fs.rename(this.filePath, this.filePath + '.broken.' + Date.now())
                } catch {
                    /* ignore */
                }
            }
            this.cache = this.normalize({})
            await this.flush()
        }
        return this.cache!
    }

    /** 读取时给出当前快照（只读语义，外部不要 mutate） */
    async read(): Promise<StoreShape> {
        return await this.load()
    }

    /**
     * 取出并清空 config.json 中残留的 usage 数组。
     * 用于从 JSON 迁移到 SQLite 的一次性操作：返回旧记录后从磁盘删除该字段。
     */
    async consumeUsage(): Promise<UsageRecord[]> {
        const s = await this.load()
        const legacy = Array.isArray(s.usage) ? s.usage : []
        if (legacy.length === 0) return []
        await this.update(cur => {
            delete cur.usage
        })
        return legacy
    }

    /** 原子地更新 store：callback 收到 mutable 引用，return 后自动 flush */
    async update(mutator: (s: StoreShape) => void | Promise<void>): Promise<StoreShape> {
        const s = await this.load()
        await mutator(s)
        await this.flush()
        return s
    }

    /** 强制把内存里的 cache 写盘（原子：写到 .tmp 再 rename） */
    async flush(): Promise<void> {
        const cache = this.cache
        if (!cache) return
        // 串行化写，避免并发覆盖
        this.writeQueue = this.writeQueue.then(async () => {
            await fs.mkdir(dirname(this.filePath), { recursive: true })
            const tmp = this.filePath + '.tmp.' + process.pid
            const data = JSON.stringify(cache, this.replacer, 2)
            await fs.writeFile(tmp, data, 'utf8')
            await fs.rename(tmp, this.filePath)
        })
        await this.writeQueue
    }

    private replacer(_key: string, value: any): any {
        // 避免 undefined 字段被 JSON.stringify 直接丢弃导致结构不一致
        return value === undefined ? null : value
    }

    private normalize(raw: Partial<StoreShape> | undefined): StoreShape {
        const s = raw ?? {}
        return {
            settings: {
                ...DEFAULT_SETTINGS,
                ...(s.settings ?? {}),
                server: { ...DEFAULT_SETTINGS.server, ...(s.settings?.server ?? {}) },
                auth: { ...DEFAULT_SETTINGS.auth, ...(s.settings?.auth ?? {}) },
                startup: { ...DEFAULT_SETTINGS.startup, ...(s.settings?.startup ?? {}) },
                log: { ...DEFAULT_SETTINGS.log, ...(s.settings?.log ?? {}) },
                models: {
                    ...DEFAULT_MODEL_CONFIG,
                    ...(s.settings?.models ?? {}),
                    builtInOverrides: { ...(s.settings?.models?.builtInOverrides ?? {}) },
                    custom: { ...(s.settings?.models?.custom ?? {}) },
                    disabled: Array.isArray(s.settings?.models?.disabled)
                        ? [...s.settings.models.disabled]
                        : [],
                },
            },
            keys: s.keys ?? [],
            // 不再默认初始化为 []；保留 raw 中的值供启动迁移读取
            usage: Array.isArray(s.usage) ? s.usage : undefined,
            clientTokens: s.clientTokens ?? [],
            gatewayTokenPlain: s.gatewayTokenPlain,
        }
    }
}

export const store = new JsonStore()
