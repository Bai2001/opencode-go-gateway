<template>
    <div class="page page-scroll">
        <el-card header="网关服务" v-loading="loading">
            <el-form :model="form" label-width="160">
                <el-form-item label="监听地址">
                    <el-radio-group
                        v-model="form.server.host"
                        :disabled="!form.server.enableLanAccess"
                    >
                        <el-radio-button value="127.0.0.1">127.0.0.1（本机）</el-radio-button>
                        <el-radio-button value="0.0.0.0">0.0.0.0（局域网）</el-radio-button>
                    </el-radio-group>
                    <div class="form-tip">未设置 Gateway Token 时可无 Token 访问</div>
                </el-form-item>
                <el-form-item label="端口">
                    <el-input-number v-model="form.server.port" :min="1" :max="65535" />
                </el-form-item>
                <el-form-item label="允许局域网访问">
                    <el-switch v-model="form.server.enableLanAccess" />
                </el-form-item>
                <el-form-item label="启动时最小化">
                    <el-switch v-model="form.startup.startMinimized" />
                </el-form-item>
                <el-form-item label="日志保留天数">
                    <el-input-number v-model="form.log.retentionDays" :min="1" :max="365" />
                </el-form-item>
                <el-form-item>
                    <el-button type="primary" :loading="saving" @click="onSave"
                        >保存并重启网关</el-button
                    >
                </el-form-item>
            </el-form>
        </el-card>

        <el-card header="Gateway Token" style="margin-top: 16px">
            <el-form label-width="160">
                <el-form-item label="当前 Token">
                    <el-input
                        v-model="currentToken"
                        type="password"
                        readonly
                        placeholder="未设置"
                        show-password
                    />
                </el-form-item>
                <el-form-item label="设置新 Token">
                    <el-input v-model="newToken" placeholder="留空表示清除 Token" show-password>
                        <template #append>
                            <el-button type="primary" @click="onSetToken">保存</el-button>
                        </template>
                    </el-input>
                </el-form-item>
            </el-form>
        </el-card>

        <el-card header="数据目录" style="margin-top: 16px">
            <el-button @click="openDataDir">打开数据目录</el-button>
            <div class="form-tip">配置文件与日志都保存在这里</div>
        </el-card>
    </div>
</template>

<script setup lang="ts">
    import { onMounted, reactive, ref } from 'vue'
    import { ElMessage } from 'element-plus'
    import { api } from '../api'

    const loading = ref(false)
    const saving = ref(false)
    const form = reactive<any>({
        server: { host: '127.0.0.1', port: 8910, enableLanAccess: false },
        auth: { requireGatewayToken: false, gatewayTokenHash: '' },
        startup: { launchAtLogin: false, startMinimized: false },
        log: { retentionDays: 30 },
    })
    const currentToken = ref('')
    const newToken = ref('')

    async function refresh() {
        loading.value = true
        try {
            const s: any = await api.settings.get()
            Object.assign(form, s)
        } catch (e: any) {
            ElMessage.error(e?.message ?? '加载失败')
        } finally {
            loading.value = false
        }
        await revealToken()
    }

    async function revealToken() {
        try {
            const t = await api.settings.revealToken()
            currentToken.value = t || '(未设置)'
        } catch (e: any) {
            ElMessage.error(e?.message ?? '无法获取 Token')
        }
    }

    async function onSave() {
        saving.value = true
        try {
            await api.settings.update({
                server: form.server,
                startup: form.startup,
                log: form.log,
            })
            ElMessage.success('已保存并重启')
        } catch (e: any) {
            ElMessage.error(e?.message ?? '保存失败')
        } finally {
            saving.value = false
        }
    }

    async function onSetToken() {
        try {
            await api.settings.setToken(newToken.value)
            ElMessage.success('已保存')
            newToken.value = ''
            await refresh()
        } catch (e: any) {
            ElMessage.error(e?.message ?? '保存失败')
        }
    }

    async function openDataDir() {
        await api.app.openDataDir()
    }

    onMounted(refresh)
</script>

<style scoped>
    .form-tip {
        margin-top: 4px;
        color: var(--color-text-muted);
        font-size: 12px;
    }
</style>
