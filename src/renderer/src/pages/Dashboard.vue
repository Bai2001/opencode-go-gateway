<template>
    <div class="page page-scroll">
        <el-row :gutter="20">
            <el-col :span="6">
                <el-card>
                    <div class="stat-label">网关状态</div>
                    <div class="stat-value" :class="{ ok: status.running, bad: !status.running }">
                        {{ status.running ? '运行中' : '未启动' }}
                    </div>
                    <div class="stat-sub">{{ status.host }}:{{ status.port }}</div>
                </el-card>
            </el-col>
            <el-col :span="6">
                <el-card>
                    <div class="stat-label">可用 Key</div>
                    <div class="stat-value">{{ activeKeyCount }} / {{ totalKeyCount }}</div>
                    <div class="stat-sub">启用且未冷却</div>
                </el-card>
            </el-col>
            <el-col :span="6">
                <el-card>
                    <div class="stat-label">5h 请求数</div>
                    <div class="stat-value">{{ summary.totalRequests }}</div>
                    <div class="stat-sub">
                        成功 {{ summary.successRequests }} / 失败 {{ summary.failedRequests }}
                    </div>
                </el-card>
            </el-col>
            <el-col :span="6">
                <el-card>
                    <div class="stat-label">5h 估算成本</div>
                    <div class="stat-value">{{ summary.estimatedCost }}</div>
                    <div class="stat-sub">
                        input {{ summary.totalInputTokens }} / output
                        {{ summary.totalOutputTokens }} tokens
                    </div>
                </el-card>
            </el-col>
        </el-row>

        <el-row :gutter="20" style="margin-top: 20px">
            <el-col :span="12">
                <el-card header="按 Key 用量（5h）">
                    <el-table :data="summary.byKey" stripe>
                        <el-table-column prop="keyPreview" label="Key" />
                        <el-table-column prop="requests" label="请求数" width="100" />
                        <el-table-column prop="estimatedCost" label="估算成本" width="120" />
                    </el-table>
                </el-card>
            </el-col>
            <el-col :span="12">
                <el-card header="按模型用量（5h）">
                    <el-table :data="summary.byModel" stripe>
                        <el-table-column prop="model" label="模型" />
                        <el-table-column prop="requests" label="请求数" width="100" />
                        <el-table-column prop="estimatedCost" label="估算成本" width="120" />
                    </el-table>
                </el-card>
            </el-col>
        </el-row>
    </div>
</template>

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue'
    import { api } from '../api'

    const status = ref<any>({ running: false, host: '127.0.0.1', port: 8910 })
    const summary = ref<any>({
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        estimatedCost: 0,
        byKey: [],
        byModel: [],
    })
    const keys = ref<any[]>([])

    const totalKeyCount = computed(() => keys.value.length)
    const activeKeyCount = computed(
        () => keys.value.filter(k => k.enabled && k.status === 'active').length
    )

    async function refresh() {
        try {
            status.value = await api.gateway.status()
            keys.value = await api.keys.list()
            summary.value = await api.usage.summary('5h')
        } catch (e) {
            /* ignore */
        }
    }

    onMounted(() => {
        refresh()
        setInterval(refresh, 5000)
    })
</script>

<style scoped>
    .stat-label {
        color: var(--color-text-muted);
        font-size: 12px;
    }
    .stat-value {
        font-size: 24px;
        font-weight: 600;
        margin: 6px 0;
    }
    .stat-value.ok {
        color: var(--color-success);
    }
    .stat-value.bad {
        color: var(--color-danger);
    }
    .stat-sub {
        color: var(--color-text-muted);
        font-size: 12px;
    }
</style>
