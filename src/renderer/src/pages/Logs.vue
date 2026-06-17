<template>
    <div class="page table-page">
        <el-card class="table-card">
            <div class="toolbar">
                <el-select
                    v-model="statusFilter"
                    placeholder="状态"
                    clearable
                    style="width: 140px"
                    @change="refresh"
                >
                    <el-option label="成功" value="success" />
                    <el-option label="失败" value="failed" />
                </el-select>
                <el-button @click="refresh">刷新</el-button>
            </div>
            <el-table :data="filtered" stripe height="100%" v-loading="loading">
                <el-table-column label="时间" width="170">
                    <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
                </el-table-column>
                <el-table-column prop="model" label="模型" width="160" />
                <el-table-column label="Key" width="160">
                    <template #default="{ row }">{{
                        row.keyId ? row.keyId.slice(0, 8) : '—'
                    }}</template>
                </el-table-column>
                <el-table-column label="流式" width="80">
                    <template #default="{ row }">{{ row.stream ? '是' : '否' }}</template>
                </el-table-column>
                <el-table-column prop="httpStatus" label="状态码" width="80" />
                <el-table-column label="状态" width="100">
                    <template #default="{ row }">
                        <el-tag
                            :type="row.status === 'success' ? 'success' : 'danger'"
                            size="small"
                        >
                            {{ row.status }}
                        </el-tag>
                    </template>
                </el-table-column>
                <el-table-column label="Tokens" width="160">
                    <template #default="{ row }">
                        in {{ row.inputTokens ?? 0 }} / out {{ row.outputTokens ?? 0 }}
                    </template>
                </el-table-column>
                <el-table-column prop="latencyMs" label="耗时(ms)" width="100" />
                <el-table-column prop="errorCode" label="错误码" width="120" />
                <el-table-column prop="errorMessage" label="错误信息" show-overflow-tooltip />
                <el-table-column label="操作" width="100" fixed="right">
                    <template #default="{ row }">
                        <el-button size="small" link type="primary" @click="openDetail(row)"
                            >详情</el-button
                        >
                    </template>
                </el-table-column>
            </el-table>
        </el-card>

        <el-drawer
            v-model="detailVisible"
            :title="detailTitle"
            size="70%"
            destroy-on-close
            direction="rtl"
        >
            <div v-if="loadingDetail" v-loading="true" style="height: 200px" />
            <div v-else-if="detail" class="detail">
                <el-tabs v-model="activeTab">
                    <el-tab-pane label="客户端 → 网关" name="cr">
                        <div class="meta">
                            <span
                                >{{ detail.clientRequest?.method }}
                                {{ detail.clientRequest?.url }}</span
                            >
                            <span v-if="detail.clientRequest?.bodyBytes"
                                >{{ detail.clientRequest?.bodyBytes }} 字节</span
                            >
                        </div>
                        <SectionHeaders :headers="detail.clientRequest?.headers" />
                        <SectionBody
                            :body="detail.clientRequest?.body"
                            :bytes="detail.clientRequest?.bodyBytes"
                            :truncated="detail.clientRequest?.bodyTruncated"
                        />
                    </el-tab-pane>

                    <el-tab-pane label="网关 → 上游" name="ur">
                        <div class="meta">
                            <span
                                >{{ detail.upstreamRequest?.method }}
                                {{ detail.upstreamRequest?.url }}</span
                            >
                            <span v-if="detail.upstreamRequest?.bodyBytes"
                                >{{ detail.upstreamRequest?.bodyBytes }} 字节</span
                            >
                        </div>
                        <SectionHeaders :headers="detail.upstreamRequest?.headers" />
                        <SectionBody
                            :body="detail.upstreamRequest?.body"
                            :bytes="detail.upstreamRequest?.bodyBytes"
                            :truncated="detail.upstreamRequest?.bodyTruncated"
                        />
                    </el-tab-pane>

                    <el-tab-pane label="上游 → 网关" name="urs">
                        <div class="meta">
                            <span>HTTP {{ detail.upstreamResponse?.status }}</span>
                            <span v-if="detail.upstreamResponse?.bodyBytes"
                                >{{ detail.upstreamResponse?.bodyBytes }} 字节</span
                            >
                        </div>
                        <SectionHeaders :headers="detail.upstreamResponse?.headers" />
                        <SectionStreamBody :resp="detail.upstreamResponse" />
                    </el-tab-pane>

                    <el-tab-pane label="网关 → 客户端" name="csr">
                        <div class="meta">
                            <span>HTTP {{ detail.clientResponse?.status }}</span>
                            <span v-if="detail.clientResponse?.bodyBytes"
                                >{{ detail.clientResponse?.bodyBytes }} 字节</span
                            >
                        </div>
                        <SectionHeaders :headers="detail.clientResponse?.headers" />
                        <SectionStreamBody :resp="detail.clientResponse" />
                    </el-tab-pane>
                </el-tabs>
            </div>
        </el-drawer>
    </div>
</template>

<script setup lang="ts">
    import { computed, h, onMounted, ref } from 'vue'
    import { api } from '../api'
    import VueJsonViewer from 'vue-json-viewer'
    import 'vue-json-viewer/style.css'

    const records = ref<any[]>([])
    const loading = ref(false)
    const statusFilter = ref<string>('')

    const filtered = computed(() => {
        if (!statusFilter.value) return records.value
        return records.value.filter(r => r.status === statusFilter.value)
    })

    function formatTime(ts: number) {
        return new Date(ts).toLocaleString('zh-CN', { hour12: false })
    }

    async function refresh() {
        loading.value = true
        try {
            records.value = await api.usage.list({ limit: 200 })
        } catch (e) {
            /* ignore */
        } finally {
            loading.value = false
        }
    }

    const detailVisible = ref(false)
    const loadingDetail = ref(false)
    const detail = ref<any>(null)
    const activeTab = ref('cr')
    const detailTitle = computed(() => {
        if (!detail.value) return '请求详情'
        const t = formatTime(detail.value.createdAt)
        return `${detail.value.model} · ${t}`
    })

    async function openDetail(row: any) {
        detail.value = null
        detailVisible.value = true
        loadingDetail.value = true
        try {
            detail.value = await api.usage.detail(row.id)
        } catch (e) {
            /* ignore */
        } finally {
            loadingDetail.value = false
        }
    }

    // 局部小组件
    const SectionHeaders = (props: { headers?: Record<string, string> }) => {
        if (!props.headers || Object.keys(props.headers).length === 0) {
            return h('div', { class: 'hint' }, '（无 header）')
        }
        const rows = Object.entries(props.headers).map(([k, v]) => ({ key: k, value: v as string }))
        return h('table', { class: 'headers-table' }, [
            h('thead', null, [
                h('tr', null, [
                    h('th', { class: 'headers-th' }, 'Header'),
                    h('th', { class: 'headers-th' }, 'Value'),
                ]),
            ]),
            h(
                'tbody',
                null,
                rows.map(row =>
                    h('tr', { key: row.key }, [
                        h('td', { class: 'headers-td-key' }, row.key),
                        h('td', { class: 'headers-td-value' }, row.value),
                    ])
                )
            ),
        ])
    }

    function parseJson(body?: string): unknown {
        if (!body) return null
        try {
            return JSON.parse(body)
        } catch {
            return null
        }
    }

    const SectionBody = (props: { body?: string; bytes?: number; truncated?: boolean }) => {
        if (!props.body && !props.bytes) return h('div', { class: 'hint' }, '（无 body）')
        const json = parseJson(props.body)
        return h('div', null, [
            h('div', { class: 'body-meta' }, [
                props.bytes ? `${props.bytes} 字节` : '',
                props.truncated ? ' · 已截断' : '',
            ]),
            json !== null
                ? h(VueJsonViewer, {
                      value: json,
                      expanded: true,
                      expandDepth: 3,
                      copyable: { copyText: '复制', copiedText: '已复制', timeout: 1200 },
                  })
                : h('pre', { class: 'body' }, props.body || ''),
        ])
    }

    function parseSseStream(raw?: string): Array<{ id?: string; event?: string; data: unknown }> {
        if (!raw) return []
        const events: Array<{ id?: string; event?: string; data: unknown }> = []
        let current: { id?: string; event?: string; data?: string } = {}
        for (const line of raw.split('\n')) {
            if (line.startsWith('id:')) {
                current.id = line.slice(3).trim()
            } else if (line.startsWith('event:')) {
                current.event = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
                current.data = line.slice(5).trim()
            } else if (line.trim() === '') {
                if (current.data !== undefined) {
                    let parsed: unknown = current.data
                    try {
                        parsed = JSON.parse(current.data)
                    } catch {
                        /* 保持原始文本 */
                    }
                    events.push({ id: current.id, event: current.event, data: parsed })
                }
                current = {}
            }
        }
        if (current.data !== undefined) {
            let parsed: unknown = current.data
            try {
                parsed = JSON.parse(current.data)
            } catch {
                /* 保持原始文本 */
            }
            events.push({ id: current.id, event: current.event, data: parsed })
        }
        return events
    }

    const SectionStreamBody = (props: { resp?: any }) => {
        if (!props.resp) return h('div', { class: 'hint' }, '（无响应）')
        if (props.resp.rawStream !== undefined) {
            const events = parseSseStream(props.resp.rawStream)
            return h('div', null, [
                h('div', { class: 'body-meta' }, [
                    `${props.resp.bodyBytes ?? 0} 字节`,
                    props.resp.bodyTruncated ? ' · 已截断' : '',
                    ` · 流式 SSE 拼接（${events.length} 条事件）`,
                ]),
                events.length > 0
                    ? h(
                          'div',
                          { class: 'sse-events' },
                          events.map((ev, idx) =>
                              h('div', { key: idx, class: 'sse-event' }, [
                                  h('div', { class: 'sse-event-meta' }, [
                                      ev.event
                                          ? h('span', { class: 'sse-event-name' }, ev.event)
                                          : null,
                                      ev.id
                                          ? h('span', { class: 'sse-event-id' }, `id: ${ev.id}`)
                                          : null,
                                  ]),
                                  h(VueJsonViewer, {
                                      value: ev.data,
                                      expanded: false,
                                      expandDepth: 1,
                                      copyable: {
                                          copyText: '复制',
                                          copiedText: '已复制',
                                          timeout: 1200,
                                      },
                                  }),
                              ])
                          )
                      )
                    : h('pre', { class: 'body' }, props.resp.rawStream || '(空)'),
            ])
        }
        return SectionBody({
            body: props.resp.body,
            bytes: props.resp.bodyBytes,
            truncated: props.resp.bodyTruncated,
        })
    }

    onMounted(refresh)
</script>

<style scoped>
    .toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
    }
    .detail {
        padding: 0 16px 16px;
    }
    .meta {
        color: var(--color-text-muted);
        font-size: 12px;
        margin-bottom: 8px;
        display: flex;
        gap: 12px;
    }
    .headers-table {
        width: 100%;
        border-collapse: collapse;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 4px;
        margin-bottom: 12px;
        font-family: 'JetBrains Maple Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        overflow: hidden;
    }
    .headers-table th,
    .headers-table td {
        padding: 8px 12px;
        text-align: left;
        border-bottom: 1px solid var(--color-border);
        vertical-align: top;
    }
    .headers-table thead {
        background: var(--color-primary-soft);
    }
    .headers-table tr:last-child td {
        border-bottom: none;
    }
    .headers-th {
        color: var(--color-text-secondary);
        font-weight: 600;
    }
    .headers-td-key {
        color: var(--color-text-primary);
        font-weight: 600;
        width: 260px;
        word-break: break-all;
    }
    .headers-td-value {
        color: var(--color-text-primary);
        word-break: break-all;
    }
    .body {
        background: var(--color-panel-dark);
        color: var(--color-border);
        border-radius: 4px;
        padding: 12px 14px;
        font-family: 'JetBrains Maple Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        line-height: 1.6;
        max-height: 500px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
    }
    :deep(.jv-code) {
        padding: 0 !important;
    }
    :deep(.jv-container) {
        background: var(--color-panel-dark);
        border-radius: 4px;
        padding: 12px 14px;
        font-family: 'JetBrains Maple Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        max-height: 500px;
        overflow: auto;
    }
    :deep(.jv-container .jv-tooltip) {
        right: 10px;
    }
    .sse-events {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .sse-event {
        background: var(--color-panel-dark);
        border-radius: 4px;
        padding: 10px 12px;
    }
    .sse-event-meta {
        display: flex;
        gap: 12px;
        margin-bottom: 6px;
        font-family: 'JetBrains Maple Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
    }
    .sse-event-name {
        color: var(--color-azure);
        font-weight: 600;
    }
    .sse-event-id {
        color: var(--color-text-muted);
    }
    .body-meta {
        color: var(--color-text-muted);
        font-size: 12px;
        margin: 6px 0;
    }
    .hint {
        color: var(--color-text-muted);
        font-size: 12px;
        padding: 8px 0;
    }
</style>
