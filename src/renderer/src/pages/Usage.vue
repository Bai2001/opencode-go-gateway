<template>
    <div class="page page-scroll">
        <el-radio-group v-model="window_" @change="refresh">
            <el-radio-button value="5h">最近 5 小时</el-radio-button>
            <el-radio-button value="7d">最近 7 天</el-radio-button>
            <el-radio-button value="30d">最近 30 天</el-radio-button>
        </el-radio-group>

        <el-row :gutter="20" style="margin-top: 16px">
            <el-col :span="6">
                <el-card>
                    <div class="stat-label">总请求数</div>
                    <div class="stat-value">{{ data.totalRequests }}</div>
                </el-card>
            </el-col>
            <el-col :span="6">
                <el-card>
                    <div class="stat-label">成功率</div>
                    <div class="stat-value">{{ successRate }}</div>
                </el-card>
            </el-col>
            <el-col :span="6">
                <el-card>
                    <div class="stat-label">总 Tokens</div>
                    <div class="stat-value">
                        {{ data.totalInputTokens + data.totalOutputTokens }}
                    </div>
                    <div class="stat-sub">
                        in {{ data.totalInputTokens }} / out {{ data.totalOutputTokens }}
                    </div>
                </el-card>
            </el-col>
            <el-col :span="6">
                <el-card>
                    <div class="stat-label">估算成本</div>
                    <div class="stat-value">{{ data.estimatedCost }}</div>
                </el-card>
            </el-col>
        </el-row>

        <el-row :gutter="20" style="margin-top: 16px">
            <el-col :span="12">
                <el-card header="按 Key 聚合">
                    <el-table :data="data.byKey" stripe>
                        <el-table-column prop="keyPreview" label="Key" />
                        <el-table-column prop="requests" label="请求数" width="100" />
                        <el-table-column prop="estimatedCost" label="估算成本" width="120" />
                    </el-table>
                </el-card>
            </el-col>
            <el-col :span="12">
                <el-card header="按模型聚合">
                    <el-table :data="data.byModel" stripe>
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

    const window_ = ref<'5h' | '7d' | '30d'>('5h')
    const data = ref<any>({
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        estimatedCost: 0,
        byKey: [],
        byModel: [],
    })

    const successRate = computed(() => {
        const t = data.value.totalRequests
        if (!t) return '0%'
        return Math.round((data.value.successRequests / t) * 1000) / 10 + '%'
    })

    async function refresh() {
        data.value = await api.usage.summary(window_.value)
    }

    onMounted(refresh)
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
    .stat-sub {
        color: var(--color-text-muted);
        font-size: 12px;
    }
</style>
