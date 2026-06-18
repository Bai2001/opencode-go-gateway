import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import type { UsageRecord, UsageSummary, UsageWindow } from '../../shared/types'

/**
 * Usage 数据的 SQLite 存储。
 *
 * 背景：原本 usage 与 settings/keys 一起塞在 config.json 中，
 * 由于单条记录可能含 256KB 级别的请求/响应 body，记录数一多
 * 就会让 JSON 文件膨胀到几百 MB，load/flush 全量读写都极慢。
 *
 * 迁移方案：
 *   - usage 独立到 usage.db（SQLite + WAL）
 *   - 主字段建索引，大字段（clientRequest/upstreamRequest/...）以 JSON 文本列存放
 *   - 启动时把 config.json 里残留的 usage 数组一次性导入并清空
 */

/** 可持久化的 JSON 文本列：驼峰字段名 → 蛇形列名 */
const JSON_COLUMN_MAP: Array<{ field: string; column: string }> = [
    { field: 'clientRequest', column: 'client_request' },
    { field: 'upstreamRequest', column: 'upstream_request' },
    { field: 'upstreamResponse', column: 'upstream_response' },
    { field: 'clientResponse', column: 'client_response' },
]

const WINDOW_MS: Record<UsageWindow, number> = {
    '5h': 5 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
}

function round(n: number): number {
    return Math.round(n * 1_000_000) / 1_000_000
}

function previewFor(keys: Array<{ id: string; keyPreview: string }>, id: string): string {
    const k = keys.find(x => x.id === id)
    return k?.keyPreview ?? '(已删除)'
}

/**
 * 把数据库行还原成 UsageRecord。
 * JSON 列反序列化时容错：损坏则视为 undefined。
 */
function rowToRecord(row: any): UsageRecord {
    const rec: UsageRecord = {
        id: row.id,
        requestId: row.request_id,
        keyId: row.key_id,
        clientId: row.client_id ?? undefined,
        model: row.model,
        endpoint: row.endpoint,
        stream: !!row.stream,
        inputTokens: row.input_tokens ?? undefined,
        outputTokens: row.output_tokens ?? undefined,
        cachedTokens: row.cached_tokens ?? undefined,
        estimatedCost: row.estimated_cost ?? undefined,
        status: row.status,
        httpStatus: row.http_status ?? undefined,
        errorCode: row.error_code ?? undefined,
        errorMessage: row.error_message ?? undefined,
        latencyMs: row.latency_ms,
        firstTokenLatencyMs: row.first_token_latency_ms ?? undefined,
        createdAt: row.created_at,
    }
    for (const { field, column } of JSON_COLUMN_MAP) {
        const raw = row[column]
        if (typeof raw === 'string' && raw.length > 0) {
            try {
                ;(rec as any)[field] = JSON.parse(raw)
            } catch {
                /* 损坏字段忽略 */
            }
        }
    }
    return rec
}

/** 把 UsageRecord 转成可绑定的 INSERT 参数 */
function recordToParams(rec: UsageRecord): Record<string, any> {
    const p: Record<string, any> = {
        id: rec.id,
        request_id: rec.requestId,
        key_id: rec.keyId,
        client_id: rec.clientId ?? null,
        model: rec.model,
        endpoint: rec.endpoint,
        stream: rec.stream ? 1 : 0,
        input_tokens: rec.inputTokens ?? null,
        output_tokens: rec.outputTokens ?? null,
        cached_tokens: rec.cachedTokens ?? null,
        estimated_cost: rec.estimatedCost ?? null,
        status: rec.status,
        http_status: rec.httpStatus ?? null,
        error_code: rec.errorCode ?? null,
        error_message: rec.errorMessage ?? null,
        latency_ms: rec.latencyMs,
        first_token_latency_ms: rec.firstTokenLatencyMs ?? null,
        created_at: rec.createdAt,
    }
    for (const { field, column } of JSON_COLUMN_MAP) {
        const v = (rec as any)[field]
        p[column] = v == null ? null : JSON.stringify(v)
    }
    return p
}

export class UsageStore {
    private db: Database.Database
    private stmts: {
        insert: Database.Statement
        update: Database.Statement
        getById: Database.Statement
        listRecent: Database.Statement
        listRecentByModel: Database.Statement
        listRecentByKey: Database.Statement
        listAll: Database.Statement
        deleteBefore: Database.Statement
        countByCreatedAt: Database.Statement
        migrateInsert: Database.Statement
    }

    constructor(fileName = 'usage.db') {
        const filePath = join(app.getPath('userData'), fileName)
        this.db = new Database(filePath)
        // WAL 模式：写入不阻塞读，崩溃后恢复能力强
        this.db.pragma('journal_mode = WAL')
        this.db.pragma('synchronous = NORMAL')
        this.db.pragma('busy_timeout = 5000')

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS usage_records (
                id TEXT PRIMARY KEY,
                request_id TEXT NOT NULL,
                key_id TEXT NOT NULL,
                client_id TEXT,
                model TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                stream INTEGER NOT NULL,
                input_tokens INTEGER,
                output_tokens INTEGER,
                cached_tokens INTEGER,
                estimated_cost REAL,
                status TEXT NOT NULL,
                http_status INTEGER,
                error_code TEXT,
                error_message TEXT,
                latency_ms INTEGER NOT NULL,
                first_token_latency_ms INTEGER,
                created_at INTEGER NOT NULL,
                client_request TEXT,
                upstream_request TEXT,
                upstream_response TEXT,
                client_response TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage_records(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_usage_key_id ON usage_records(key_id);
            CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_records(model);
        `)

        this.stmts = {
            insert: this.db.prepare(
                `INSERT INTO usage_records (
                    id, request_id, key_id, client_id, model, endpoint, stream,
                    input_tokens, output_tokens, cached_tokens, estimated_cost,
                    status, http_status, error_code, error_message,
                    latency_ms, first_token_latency_ms, created_at,
                    client_request, upstream_request, upstream_response, client_response
                ) VALUES (
                    @id, @request_id, @key_id, @client_id, @model, @endpoint, @stream,
                    @input_tokens, @output_tokens, @cached_tokens, @estimated_cost,
                    @status, @http_status, @error_code, @error_message,
                    @latency_ms, @first_token_latency_ms, @created_at,
                    @client_request, @upstream_request, @upstream_response, @client_response
                )`
            ),
            update: this.db.prepare(
                `UPDATE usage_records SET
                    input_tokens = COALESCE(@input_tokens, input_tokens),
                    output_tokens = COALESCE(@output_tokens, output_tokens),
                    cached_tokens = COALESCE(@cached_tokens, cached_tokens),
                    estimated_cost = COALESCE(@estimated_cost, estimated_cost),
                    status = COALESCE(@status, status),
                    http_status = COALESCE(@http_status, http_status),
                    error_code = COALESCE(@error_code, error_code),
                    error_message = COALESCE(@error_message, error_message),
                    latency_ms = COALESCE(@latency_ms, latency_ms),
                    first_token_latency_ms = COALESCE(@first_token_latency_ms, first_token_latency_ms),
                    upstream_request = COALESCE(@upstream_request, upstream_request),
                    upstream_response = COALESCE(@upstream_response, upstream_response),
                    client_response = COALESCE(@client_response, client_response)
                WHERE id = @id`
            ),
            getById: this.db.prepare('SELECT * FROM usage_records WHERE id = ?'),
            listRecent: this.db.prepare(
                'SELECT * FROM usage_records ORDER BY created_at DESC LIMIT ?'
            ),
            listRecentByModel: this.db.prepare(
                'SELECT * FROM usage_records WHERE model = ? ORDER BY created_at DESC LIMIT ?'
            ),
            listRecentByKey: this.db.prepare(
                'SELECT * FROM usage_records WHERE key_id = ? ORDER BY created_at DESC LIMIT ?'
            ),
            listAll: this.db.prepare('SELECT * FROM usage_records ORDER BY created_at DESC'),
            deleteBefore: this.db.prepare('DELETE FROM usage_records WHERE created_at < ?'),
            countByCreatedAt: this.db.prepare(
                'SELECT COUNT(*) AS c FROM usage_records WHERE created_at >= ?'
            ),
            migrateInsert: this.db.prepare(
                `INSERT OR IGNORE INTO usage_records (
                    id, request_id, key_id, client_id, model, endpoint, stream,
                    input_tokens, output_tokens, cached_tokens, estimated_cost,
                    status, http_status, error_code, error_message,
                    latency_ms, first_token_latency_ms, created_at,
                    client_request, upstream_request, upstream_response, client_response
                ) VALUES (
                    @id, @request_id, @key_id, @client_id, @model, @endpoint, @stream,
                    @input_tokens, @output_tokens, @cached_tokens, @estimated_cost,
                    @status, @http_status, @error_code, @error_message,
                    @latency_ms, @first_token_latency_ms, @created_at,
                    @client_request, @upstream_request, @upstream_response, @client_response
                )`
            ),
        }
    }

    get path() {
        return this.db.name
    }

    /** 写入一条 usage 记录，返回 id */
    insert(rec: UsageRecord): void {
        this.stmts.insert.run(recordToParams(rec))
    }

    /** 部分字段更新；JSON 列仅在传入时才覆盖 */
    patch(id: string, patch: Partial<UsageRecord>): void {
        const p: Record<string, any> = { id }
        if (patch.inputTokens !== undefined) p.input_tokens = patch.inputTokens ?? null
        if (patch.outputTokens !== undefined) p.output_tokens = patch.outputTokens ?? null
        if (patch.cachedTokens !== undefined) p.cached_tokens = patch.cachedTokens ?? null
        if (patch.estimatedCost !== undefined) p.estimated_cost = patch.estimatedCost ?? null
        if (patch.status !== undefined) p.status = patch.status
        if (patch.httpStatus !== undefined) p.http_status = patch.httpStatus ?? null
        if (patch.errorCode !== undefined) p.error_code = patch.errorCode ?? null
        if (patch.errorMessage !== undefined) p.error_message = patch.errorMessage ?? null
        if (patch.latencyMs !== undefined) p.latency_ms = patch.latencyMs
        if (patch.firstTokenLatencyMs !== undefined) {
            p.first_token_latency_ms = patch.firstTokenLatencyMs ?? null
        }
        if (patch.upstreamRequest !== undefined) {
            p.upstream_request = patch.upstreamRequest
                ? JSON.stringify(patch.upstreamRequest)
                : null
        }
        if (patch.upstreamResponse !== undefined) {
            p.upstream_response = patch.upstreamResponse
                ? JSON.stringify(patch.upstreamResponse)
                : null
        }
        if (patch.clientResponse !== undefined) {
            p.client_response = patch.clientResponse ? JSON.stringify(patch.clientResponse) : null
        }
        this.stmts.update.run(p)
    }

    getById(id: string): UsageRecord | null {
        const row = this.stmts.getById.get(id)
        return row ? rowToRecord(row) : null
    }

    list(opts: { limit?: number; model?: string; keyId?: string } = {}): UsageRecord[] {
        const limit = opts.limit ?? 0
        let rows: any[]
        if (opts.model) {
            rows = this.stmts.listRecentByModel.all(opts.model, limit || -1)
        } else if (opts.keyId) {
            rows = this.stmts.listRecentByKey.all(opts.keyId, limit || -1)
        } else if (limit > 0) {
            rows = this.stmts.listRecent.all(limit)
        } else {
            rows = this.stmts.listAll.all()
        }
        return rows.map(rowToRecord)
    }

    /**
     * 按时间窗口聚合统计。
     *
     * 聚合走 SQL；按 key/model 分组也走 SQL。
     * keyPreview 需要外部 keys 列表拼接，单独在 tracker 层完成。
     */
    aggregateSince(since: number, keys: Array<{ id: string; keyPreview: string }>): UsageSummary {
        const sinceStmt = this.db.prepare(`
            SELECT
                COUNT(*) AS total_requests,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_requests,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_requests,
                SUM(COALESCE(input_tokens, 0)) AS total_input,
                SUM(COALESCE(output_tokens, 0)) AS total_output,
                SUM(COALESCE(cached_tokens, 0)) AS total_cached,
                SUM(COALESCE(estimated_cost, 0)) AS total_cost
            FROM usage_records
            WHERE created_at >= ?
        `)
        const agg = sinceStmt.get(since) as any

        const byKeyStmt = this.db.prepare(`
            SELECT key_id AS keyId, COUNT(*) AS requests, SUM(COALESCE(estimated_cost, 0)) AS cost
            FROM usage_records
            WHERE created_at >= ?
            GROUP BY key_id
        `)
        const byKeyRows = byKeyStmt.all(since) as Array<{
            keyId: string
            requests: number
            cost: number
        }>

        const byModelStmt = this.db.prepare(`
            SELECT model, COUNT(*) AS requests, SUM(COALESCE(estimated_cost, 0)) AS cost
            FROM usage_records
            WHERE created_at >= ?
            GROUP BY model
        `)
        const byModelRows = byModelStmt.all(since) as Array<{
            model: string
            requests: number
            cost: number
        }>

        return {
            totalRequests: agg.total_requests ?? 0,
            successRequests: agg.success_requests ?? 0,
            failedRequests: agg.failed_requests ?? 0,
            totalInputTokens: agg.total_input ?? 0,
            totalOutputTokens: agg.total_output ?? 0,
            totalCachedTokens: agg.total_cached ?? 0,
            estimatedCost: round(agg.total_cost ?? 0),
            byKey: byKeyRows.map(k => ({
                keyId: k.keyId,
                keyPreview: k.keyId ? previewFor(keys, k.keyId) : '?',
                requests: k.requests,
                estimatedCost: round(k.cost ?? 0),
            })),
            byModel: byModelRows.map(m => ({
                model: m.model,
                requests: m.requests,
                estimatedCost: round(m.cost ?? 0),
            })),
        }
    }

    /** 删除 created_at 早于 cutoff 的记录，返回删除条数 */
    pruneBefore(cutoff: number): number {
        const info = this.stmts.deleteBefore.run(cutoff)
        return info.changes
    }

    /**
     * 迁移：把已有的 UsageRecord 数组批量导入到 SQLite。
     * 使用 INSERT OR IGNORE 避免重复 id 冲突。
     * 整个迁移在一个事务中完成。
     */
    migrateFromRecords(records: UsageRecord[]): number {
        if (records.length === 0) return 0
        let inserted = 0
        const tx = this.db.transaction((items: UsageRecord[]) => {
            for (const r of items) {
                const info = this.stmts.migrateInsert.run(recordToParams(r))
                if (info.changes > 0) inserted++
            }
        })
        tx(records)
        return inserted
    }

    /** 关闭数据库（应用退出时调用） */
    close(): void {
        try {
            this.db.close()
        } catch {
            /* ignore */
        }
    }
}

/** 单例：在 Main 进程首次 import 时即创建并建表 */
export const usageStore = new UsageStore()

/** 暴露给 tracker 用的窗口常量 */
export { WINDOW_MS }
