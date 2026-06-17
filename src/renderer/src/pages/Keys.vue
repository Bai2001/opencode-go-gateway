<template>
    <div class="page table-page">
        <el-card class="table-card">
            <div class="toolbar">
                <el-button type="primary" @click="showAddDialog">添加 Key</el-button>
                <el-button @click="refresh">刷新</el-button>
            </div>
            <el-table :data="keys" stripe height="100%" v-loading="loading">
                <el-table-column prop="name" label="名称" min-width="140">
                    <template #default="{ row }">
                        <el-input
                            v-if="editingId === row.id"
                            v-model="editingName"
                            size="small"
                            @keyup.enter="commitRename(row)"
                            @blur="commitRename(row)"
                        />
                        <span v-else class="name-cell" @click="startRename(row)">
                            {{ row.name }} <el-icon class="edit-icon"><Edit /></el-icon>
                        </span>
                    </template>
                </el-table-column>
                <el-table-column prop="keyPreview" label="Key 预览" min-width="160" />
                <el-table-column prop="status" label="状态" width="120">
                    <template #default="{ row }">
                        <el-tag :type="statusType(row.status)" size="small">{{
                            statusLabel(row.status)
                        }}</el-tag>
                        <div v-if="row.cooldownUntil" class="cooldown-tip">
                            至 {{ formatTime(row.cooldownUntil) }}
                        </div>
                    </template>
                </el-table-column>
                <el-table-column prop="weight" label="权重" width="150">
                    <template #default="{ row }">
                        <el-input-number
                            v-model="row.weight"
                            :min="1"
                            :max="10"
                            size="small"
                            @change="v => onWeightChange(row, v)"
                        />
                    </template>
                </el-table-column>
                <el-table-column prop="errorCount" label="错误数" width="80" />
                <el-table-column label="Go 用量" min-width="260">
                    <template #default="{ row }">
                        <div v-if="usageByKey[row.id]" class="usage-cell">
                            <div
                                v-for="item in usageItems(usageByKey[row.id])"
                                :key="item.key"
                                class="usage-item"
                            >
                                <div class="usage-header">
                                    <span>{{ item.label }}</span>
                                    <span>{{ item.usagePercent }}%</span>
                                </div>
                                <div class="usage-progress">
                                    <div
                                        class="usage-progress-bar"
                                        :style="{ width: `${item.usagePercent}%` }"
                                    />
                                </div>
                                <div class="usage-reset">
                                    重置于 {{ formatResetTime(item.resetsInSeconds) }}
                                </div>
                            </div>
                        </div>
                        <el-button
                            v-else
                            size="small"
                            link
                            type="primary"
                            :loading="usageLoadingByKey[row.id]"
                            @click="getUsage(row)"
                            >获取用量</el-button
                        >
                    </template>
                </el-table-column>
                <el-table-column label="最近使用" width="170">
                    <template #default="{ row }">
                        {{ row.lastUsedAt ? formatTime(row.lastUsedAt) : '—' }}
                    </template>
                </el-table-column>
                <el-table-column label="操作" width="180" fixed="right">
                    <template #default="{ row }">
                        <el-switch
                            v-model="row.enabled"
                            size="small"
                            @change="v => onToggle(row, v)"
                        />
                        <el-button size="small" link type="primary" @click="onTest(row)"
                            >测试</el-button
                        >
                        <el-button size="small" link type="warning" @click="onReset(row)"
                            >重置</el-button
                        >
                        <el-popconfirm title="确认删除该 Key？" @confirm="onDelete(row)">
                            <template #reference>
                                <el-button size="small" link type="danger">删除</el-button>
                            </template>
                        </el-popconfirm>
                    </template>
                </el-table-column>
            </el-table>
        </el-card>

        <el-dialog v-model="dialogVisible" title="添加 OpenCode Go Key" width="520">
            <el-form :model="form" label-width="80">
                <el-form-item label="名称">
                    <el-input v-model="form.name" placeholder="例如：主力 / 备用 1" />
                </el-form-item>
                <el-form-item label="Key">
                    <el-input
                        v-model="form.key"
                        type="password"
                        show-password
                        placeholder="OpenCode Go API Key"
                    />
                </el-form-item>
                <el-form-item label="权重">
                    <el-input-number v-model="form.weight" :min="1" :max="10" />
                    <span class="form-tip">数字越大，调度越优先</span>
                </el-form-item>
            </el-form>
            <template #footer>
                <el-button @click="dialogVisible = false">取消</el-button>
                <el-button type="primary" :loading="saving" @click="onAdd">保存</el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
    import { onMounted, ref } from 'vue'
    import { ElMessage } from 'element-plus'
    import { Edit } from '@element-plus/icons-vue'
    import { api } from '../api'

    const keys = ref<any[]>([])
    const loading = ref(false)
    const dialogVisible = ref(false)
    const saving = ref(false)
    const form = ref({ name: '', key: '', weight: 1 })
    const editingId = ref<string | null>(null)
    const editingName = ref('')
    const usageByKey = ref<Record<string, any>>({})
    const usageLoadingByKey = ref<Record<string, boolean>>({})

    function statusLabel(s: string) {
        return (
            (
                {
                    active: '正常',
                    cooldown: '冷却中',
                    disabled: '已禁用',
                    invalid: '已失效',
                    exhausted: '已耗尽',
                } as any
            )[s] ?? s
        )
    }
    function statusType(s: string) {
        return (
            (
                {
                    active: 'success',
                    cooldown: 'warning',
                    disabled: 'info',
                    invalid: 'danger',
                    exhausted: 'danger',
                } as any
            )[s] ?? 'info'
        )
    }
    function formatTime(ts: number) {
        return new Date(ts).toLocaleString('zh-CN', { hour12: false })
    }
    function formatResetTime(seconds: number) {
        const safeSeconds = Math.max(0, Math.floor(seconds))
        const days = Math.floor(safeSeconds / 86400)
        const hours = Math.floor((safeSeconds % 86400) / 3600)
        const minutes = Math.ceil((safeSeconds % 3600) / 60)
        if (days > 0) return `${days} 天 ${hours} 小时`
        if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
        return `${minutes} 分钟`
    }
    function usageItems(usage: any) {
        return [
            { key: 'rolling', label: '滚动用量', ...usage.windows.rolling },
            { key: 'weekly', label: '每周用量', ...usage.windows.weekly },
            { key: 'monthly', label: '每月用量', ...usage.windows.monthly },
        ]
    }

    async function refresh() {
        loading.value = true
        try {
            keys.value = await api.keys.list()
        } catch (e: any) {
            ElMessage.error(e?.message ?? '加载失败')
        } finally {
            loading.value = false
        }
    }

    function showAddDialog() {
        form.value = { name: '', key: '', weight: 1 }
        dialogVisible.value = true
    }

    async function onAdd() {
        if (!form.value.name.trim() || !form.value.key.trim()) {
            ElMessage.warning('名称和 Key 都不能为空')
            return
        }
        saving.value = true
        try {
            await api.keys.add({
                name: form.value.name,
                key: form.value.key,
                weight: form.value.weight,
            })
            ElMessage.success('已添加')
            dialogVisible.value = false
            await refresh()
        } catch (e: any) {
            ElMessage.error(e?.message ?? '保存失败')
        } finally {
            saving.value = false
        }
    }

    async function onDelete(row: any) {
        await api.keys.remove(row.id)
        ElMessage.success('已删除')
        await refresh()
    }

    async function onToggle(row: any, v: string | number | boolean) {
        try {
            await api.keys.setEnabled(row.id, Boolean(v))
        } catch (e: any) {
            ElMessage.error(e?.message ?? '操作失败')
            await refresh()
        }
    }

    async function onWeightChange(row: any, v: number | undefined) {
        if (v == null) return
        try {
            await api.keys.setWeight(row.id, v)
        } catch (e: any) {
            ElMessage.error(e?.message ?? '操作失败')
        }
    }

    async function onTest(row: any) {
        const loading = ElMessage({ message: '正在测试…', duration: 0 })
        try {
            const r = await api.keys.test(row.id)
            if (r.ok) {
                ElMessage.success(`通过（${r.httpStatus}，${r.latencyMs}ms）`)
            } else {
                ElMessage.error(`失败：${r.errorCode} ${r.httpStatus} ${r.errorMessage ?? ''}`)
            }
        } catch (e: any) {
            ElMessage.error(e?.message ?? '测试失败')
        } finally {
            loading.close()
        }
    }

    async function getUsage(row: any) {
        usageLoadingByKey.value[row.id] = true
        try {
            usageByKey.value[row.id] = await api.keys.goUsage(row.id)
        } catch (e: any) {
            ElMessage.error(e?.message ?? '获取用量失败')
        } finally {
            usageLoadingByKey.value[row.id] = false
        }
    }

    async function onReset(row: any) {
        await api.keys.reset(row.id)
        ElMessage.success('已重置')
        await refresh()
    }

    function startRename(row: any) {
        editingId.value = row.id
        editingName.value = row.name
    }

    async function commitRename(row: any) {
        if (editingId.value !== row.id) return
        const v = editingName.value.trim()
        editingId.value = null
        if (!v || v === row.name) return
        try {
            await api.keys.rename(row.id, v)
            row.name = v
        } catch (e: any) {
            ElMessage.error(e?.message ?? '重命名失败')
        }
    }

    onMounted(refresh)
</script>

<style scoped>
    .toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
    }
    .name-cell {
        cursor: pointer;
    }
    .name-cell:hover .edit-icon {
        visibility: visible;
    }
    .edit-icon {
        visibility: hidden;
        margin-left: 6px;
        color: var(--color-text-muted);
    }
    .cooldown-tip {
        font-size: 11px;
        color: var(--color-warning);
        margin-top: 2px;
    }
    .usage-cell {
        font-size: 12px;
        line-height: 1.5;
    }
    .usage-item + .usage-item {
        margin-top: 6px;
    }
    .usage-header {
        display: flex;
        justify-content: space-between;
        gap: 8px;
    }
    .usage-progress {
        height: 6px;
        border-radius: 999px;
        background: var(--el-fill-color-light);
        overflow: hidden;
        margin: 3px 0;
    }
    .usage-progress-bar {
        height: 100%;
        border-radius: inherit;
        background: var(--el-color-primary);
    }
    .usage-reset {
        color: var(--color-text-muted);
    }
    .form-tip {
        margin-left: 8px;
        color: var(--color-text-muted);
        font-size: 12px;
    }
</style>
