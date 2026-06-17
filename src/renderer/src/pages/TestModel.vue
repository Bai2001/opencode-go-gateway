<template>
    <div class="page page-scroll">
        <el-card header="测试模型可用性">
            <el-alert
                type="info"
                :closable="false"
                show-icon
                title="此页面向 OpenCode Go 上游直接发请求，绕开本机 Key 池和用量统计。可选择已配置的 Key，或临时输入，均不会保存。"
            />

            <el-form :model="form" label-width="100" style="margin-top: 16px">
                <el-form-item label="模型">
                    <el-select v-model="form.model" filterable style="width: 320px">
                        <el-option v-for="m in models" :key="m" :label="m" :value="m" />
                    </el-select>
                </el-form-item>
                <el-form-item label="Key">
                    <div style="display: flex; flex-direction: column; gap: 8px; width: 480px">
                        <el-select
                            v-model="form.keyId"
                            clearable
                            placeholder="选择已配置的 Key（可选）"
                        >
                            <el-option
                                v-for="k in keys"
                                :key="k.id"
                                :label="`${k.name} (${k.keyPreview})`"
                                :value="k.id"
                            />
                        </el-select>
                        <el-input
                            v-show="!form.keyId"
                            v-model="form.apiKey"
                            type="password"
                            show-password
                            placeholder="或直接输入 OpenCode Key sk-..."
                        />
                    </div>
                </el-form-item>
                <el-form-item label="Prompt">
                    <el-input
                        v-model="form.prompt"
                        type="textarea"
                        :rows="3"
                        placeholder="用户消息"
                    />
                </el-form-item>
                <el-form-item label="max_tokens">
                    <el-input-number v-model="form.maxTokens" :min="1" :max="200000" />
                </el-form-item>
                <el-form-item label="流式">
                    <el-switch v-model="form.stream" />
                </el-form-item>
                <el-form-item>
                    <el-button type="primary" :loading="loading" @click="onRun">发送</el-button>
                    <el-button @click="onClear">清空</el-button>
                </el-form-item>
            </el-form>
        </el-card>

        <el-card v-if="result" style="margin-top: 16px">
            <template #header>
                <div class="result-header">
                    <el-tag :type="result.ok ? 'success' : 'danger'" size="small">
                        {{ result.ok ? '成功' : '失败' }}
                    </el-tag>
                    <span class="meta"
                        >HTTP {{ result.httpStatus }} · {{ result.latencyMs }} ms</span
                    >
                </div>
            </template>

            <template v-if="result.ok">
                <template v-if="result.json">
                    <div class="kv">
                        <div class="k">model</div>
                        <div class="v">{{ result.json.model }}</div>
                    </div>
                    <div class="kv">
                        <div class="k">content</div>
                        <pre class="v pre">{{ extractContent(result.json) }}</pre>
                    </div>
                    <div class="kv" v-if="extractReasoning(result.json)">
                        <div class="k">reasoning</div>
                        <pre class="v pre">{{ extractReasoning(result.json) }}</pre>
                    </div>
                    <div class="kv" v-if="result.json.usage">
                        <div class="k">usage</div>
                        <pre class="v pre">{{
                            JSON.stringify(normalizeUsage(result.json.usage), null, 2)
                        }}</pre>
                    </div>
                </template>
                <template v-else>
                    <div class="kv">
                        <div class="k">SSE raw</div>
                        <pre class="v pre">{{ result.rawStream }}</pre>
                    </div>
                </template>
            </template>

            <template v-else>
                <div class="kv">
                    <div class="k">error</div>
                    <pre class="v pre">{{ result.errorBody || result.errorMessage }}</pre>
                </div>
            </template>
        </el-card>
    </div>
</template>

<script setup lang="ts">
    import { onMounted, reactive, ref } from 'vue'
    import { ElMessage } from 'element-plus'
    import { api } from '../api'
    import {
        extractReasoningContent,
        extractResponseText,
        normalizeUsage,
    } from '../../../shared/response-helpers'

    const models = ref<string[]>([])
    const loading = ref(false)
    const keys = ref<any[]>([])
    const form = reactive({
        model: '',
        keyId: '',
        apiKey: '',
        prompt: '你好',
        maxTokens: 200,
        stream: false,
    })

    const result = ref<any>(null)

    async function onRun() {
        if (!form.keyId && !form.apiKey) {
            ElMessage.warning('请选择已配置的 Key 或直接输入 Key')
            return
        }
        if (!form.prompt) {
            ElMessage.warning('请填写 Prompt')
            return
        }
        loading.value = true
        result.value = null
        try {
            const r: any = await api.test.runModel({
                model: form.model,
                keyId: form.keyId || undefined,
                apiKey: form.apiKey || undefined,
                prompt: form.prompt,
                stream: form.stream,
                maxTokens: form.maxTokens,
            })
            result.value = r
        } catch (e: any) {
            ElMessage.error(e?.message ?? '请求失败')
        } finally {
            loading.value = false
        }
    }

    function onClear() {
        result.value = null
    }

    function extractContent(json: any): string {
        if (!json) return ''
        const text = extractResponseText(json)
        return text || JSON.stringify(json, null, 2)
    }

    function extractReasoning(json: any): string {
        if (!json) return ''
        return extractReasoningContent(json) || ''
    }

    onMounted(async () => {
        try {
            keys.value = await api.keys.list()
        } catch {
            keys.value = []
        }
        try {
            const list = await api.models.list()
            models.value = list.filter((m: any) => m.enabled).map((m: any) => m.id)
            if (!form.model && models.value.length) {
                form.model = models.value[0]
            }
        } catch {
            models.value = []
        }
    })
</script>

<style scoped>
    .result-header {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .meta {
        color: var(--color-text-muted);
        font-size: 12px;
    }
    .kv {
        display: flex;
        gap: 12px;
        margin-bottom: 8px;
        align-items: flex-start;
    }
    .k {
        color: var(--color-text-muted);
        width: 80px;
        flex-shrink: 0;
        padding-top: 4px;
    }
    .v {
        flex: 1;
        color: var(--color-text-secondary);
        word-break: break-word;
        white-space: pre-wrap;
    }
    .pre {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 4px;
        padding: 8px 10px;
        font-family: 'JetBrains Maple Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        line-height: 1.5;
        max-height: 360px;
        overflow: auto;
    }
</style>
