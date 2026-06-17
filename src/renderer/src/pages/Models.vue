<template>
    <div class="page table-page">
        <el-card class="table-card">
            <div class="toolbar">
                <el-button type="primary" @click="showAddDialog">添加自定义模型</el-button>
                <el-button @click="refresh">刷新</el-button>
                <el-button :loading="syncing" type="success" @click="onSyncFromDocs">
                    从官网同步模型
                </el-button>
            </div>
            <el-table :data="models" stripe height="100%" v-loading="loading">
                <el-table-column prop="id" label="模型 ID" min-width="180" />
                <el-table-column prop="source" label="来源" width="100">
                    <template #default="{ row }">
                        <el-tag :type="row.source === 'built-in' ? 'info' : 'success'" size="small">
                            {{ row.source === 'built-in' ? '内置' : '自定义' }}
                        </el-tag>
                    </template>
                </el-table-column>
                <el-table-column label="输入" width="110">
                    <template #default="{ row }">
                        <span v-if="row.inputPrice">${{ row.inputPrice }}</span>
                        <span v-else class="no-price">—</span>
                    </template>
                </el-table-column>
                <el-table-column label="缓存输入" width="110">
                    <template #default="{ row }">
                        <span v-if="row.cachedPrice">${{ row.cachedPrice }}</span>
                        <span v-else class="no-price">—</span>
                    </template>
                </el-table-column>
                <el-table-column label="输出" width="110">
                    <template #default="{ row }">
                        <span v-if="row.outputPrice">${{ row.outputPrice }}</span>
                        <span v-else class="no-price">—</span>
                    </template>
                </el-table-column>
                <el-table-column label="启用" width="100">
                    <template #default="{ row }">
                        <el-switch v-model="row.enabled" @change="v => onToggle(row, v)" />
                    </template>
                </el-table-column>
                <el-table-column label="操作" width="120" fixed="right">
                    <template #default="{ row }">
                        <el-popconfirm
                            v-if="row.source === 'custom'"
                            title="确认删除该自定义模型？"
                            @confirm="onDelete(row)"
                        >
                            <template #reference>
                                <el-button size="small" link type="danger">删除</el-button>
                            </template>
                        </el-popconfirm>
                    </template>
                </el-table-column>
            </el-table>
        </el-card>

        <el-dialog v-model="dialogVisible" title="添加自定义模型" width="520">
            <el-form :model="form" label-width="120">
                <el-form-item label="模型 ID">
                    <el-input v-model="form.id" placeholder="例如：my-custom-model" />
                </el-form-item>
                <el-form-item label="上游 URL">
                    <el-input
                        v-model="form.upstreamUrl"
                        placeholder="https://opencode.ai/zen/go/v1/chat/completions"
                    />
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
    import { api } from '../api'

    type ModelItem = {
        id: string
        upstreamUrl: string
        source: 'built-in' | 'custom'
        enabled: boolean
        inputPrice?: number
        outputPrice?: number
        cachedPrice?: number
    }

    const models = ref<ModelItem[]>([])
    const loading = ref(false)
    const syncing = ref(false)
    const dialogVisible = ref(false)
    const saving = ref(false)
    const form = ref({ id: '', upstreamUrl: '' })

    async function refresh() {
        loading.value = true
        try {
            models.value = await api.models.list()
        } catch (e: any) {
            ElMessage.error(e?.message ?? '加载失败')
        } finally {
            loading.value = false
        }
    }

    function showAddDialog() {
        form.value = { id: '', upstreamUrl: 'https://opencode.ai/zen/go/v1/chat/completions' }
        dialogVisible.value = true
    }

    async function onAdd() {
        const id = form.value.id.trim()
        const upstreamUrl = form.value.upstreamUrl.trim()
        if (!id || !upstreamUrl) {
            ElMessage.warning('模型 ID 和上游 URL 都不能为空')
            return
        }
        saving.value = true
        try {
            await api.models.add({ id, upstreamUrl })
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
        try {
            await api.models.remove(row.id)
            ElMessage.success('已删除')
            await refresh()
        } catch (e: any) {
            ElMessage.error(e?.message ?? '删除失败')
        }
    }

    async function onToggle(row: any, v: string | number | boolean) {
        try {
            await api.models.setEnabled(row.id, Boolean(v))
        } catch (e: any) {
            ElMessage.error(e?.message ?? '操作失败')
            await refresh()
        }
    }

    async function onSyncFromDocs() {
        syncing.value = true
        try {
            const list = await api.models.syncFromDocs()
            ElMessage.success(`已同步 ${list.length} 个模型`)
            await refresh()
        } catch (e: any) {
            ElMessage.error(e?.message ?? '同步失败')
        } finally {
            syncing.value = false
        }
    }

    onMounted(() => {
        refresh()
    })
</script>

<style scoped>
    .toolbar {
        margin-bottom: 16px;
    }
    .no-price {
        color: var(--color-text-muted);
        font-size: 13px;
    }
</style>
