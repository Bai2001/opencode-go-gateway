<template>
    <el-container class="layout">
        <el-aside class="aside">
            <div class="brand">
                <img class="brand-logo" src="/logo.png" alt="logo" />
                <div class="brand-text">
                    <span class="brand-title">OpenCode Go</span>
                    <span class="brand-sub">Gateway</span>
                </div>
            </div>
            <el-menu :default-active="activeMenu" :router="true" class="menu">
                <el-menu-item index="/dashboard">
                    <el-icon><DataLine /></el-icon>
                    <span>概览</span>
                </el-menu-item>
                <el-menu-item index="/keys">
                    <el-icon><Key /></el-icon>
                    <span>Key 管理</span>
                </el-menu-item>
                <el-menu-item index="/models">
                    <el-icon><Cpu /></el-icon>
                    <span>模型配置</span>
                </el-menu-item>
                <el-menu-item index="/usage">
                    <el-icon><PieChart /></el-icon>
                    <span>用量</span>
                </el-menu-item>
                <el-menu-item index="/logs">
                    <el-icon><Document /></el-icon>
                    <span>日志</span>
                </el-menu-item>
                <el-menu-item index="/settings">
                    <el-icon><Setting /></el-icon>
                    <span>设置</span>
                </el-menu-item>
                <el-menu-item index="/test">
                    <el-icon><Connection /></el-icon>
                    <span>测试模型</span>
                </el-menu-item>
            </el-menu>
        </el-aside>
        <el-container class="content-shell">
            <el-header class="header">
                <span class="header-title">{{ pageTitle }}</span>
                <div class="header-status">
                    <el-tag :type="status.running ? 'success' : 'danger'" size="small">
                        {{ status.running ? '运行中' : '未启动' }}
                    </el-tag>
                    <span class="header-host">{{ status.host }}:{{ status.port }}</span>
                </div>
            </el-header>
            <el-main class="main-content">
                <router-view />
            </el-main>
        </el-container>
    </el-container>
</template>

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue'
    import { useRoute } from 'vue-router'
    import {
        DataLine,
        Key,
        Cpu,
        PieChart,
        Document,
        Setting,
        Connection,
    } from '@element-plus/icons-vue'
    import { api } from './api'

    const route = useRoute()
    const activeMenu = computed(() => route.path)
    const pageTitle = computed(() => (route.meta?.title as string) ?? '')

    const status = ref<any>({ running: false, host: '127.0.0.1', port: 8910 })

    async function refreshStatus() {
        try {
            status.value = await api.gateway.status()
        } catch (e) {
            /* ignore */
        }
    }

    onMounted(() => {
        refreshStatus()
        setInterval(refreshStatus, 5000)
    })
</script>

<style>
    @font-face {
        font-family: 'JetBrains Maple Mono';
        src: url('./assets/fonts/JetBrainsMapleMono-Medium.ttf') format('truetype');
        font-weight: 500;
        font-style: normal;
        font-display: swap;
    }

    :root {
        /* 品牌色 */
        --color-primary: #0558f2;
        --color-primary-hover: #0447c8;
        --color-primary-soft: #eef4ff;
        --color-navy: #05256b;
        --color-azure: #69a3e8;

        /* 辅助色 */
        --color-teal: #05b0b9;
        --color-purple: #5a31e4;
        --color-violet: #8371d4;

        /* 背景色 */
        --color-bg: #f8faff;
        --color-card: #ffffff;
        --color-panel-dark: #061a3d;

        /* 边框色 */
        --color-border: #d2d9f5;
        --color-border-strong: #9eb8ec;

        /* 文本色 */
        --color-text-primary: #111827;
        --color-text-secondary: #374151;
        --color-text-muted: #6b7280;
        --color-text-inverse: #ffffff;

        /* 语义色 */
        --color-success: #05b0b9;
        --color-warning: #f59e0b;
        --color-danger: #ef4444;
        --color-cooldown: #7c3aed;
        --color-info: #0558f2;

        /* 渐变色 */
        --gradient-brand: linear-gradient(135deg, #0558f2 0%, #05b0b9 45%, #5a31e4 100%);
        --gradient-blue-purple: linear-gradient(135deg, #0558f2 0%, #5a31e4 100%);
        --gradient-teal-blue: linear-gradient(135deg, #05b0b9 0%, #0558f2 100%);

        --el-font-family:
            'JetBrains Maple Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
            'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
        --el-color-primary: #0558f2;
        --el-color-primary-light-3: #69a3e8;
        --el-color-primary-light-5: #9eb8ec;
        --el-color-primary-light-7: #d2d9f5;
        --el-color-primary-light-9: #eef4ff;
        --el-color-primary-dark-2: #0447c8;
        --el-color-success: #05b0b9;
        --el-color-warning: #f59e0b;
        --el-color-danger: #ef4444;
        --el-color-info: #6b7280;
        --el-bg-color-page: #f8faff;
        --el-bg-color: #ffffff;
        --el-border-color: #d2d9f5;
        --el-border-color-light: #d2d9f5;
        --el-border-color-lighter: #eef4ff;
        --el-text-color-primary: #111827;
        --el-text-color-regular: #374151;
        --el-text-color-secondary: #6b7280;
        --el-fill-color-light: #eef4ff;
        --el-fill-color-lighter: #f8faff;
        --el-fill-color-blank: #ffffff;

        --scrollbar-size: 10px;
        --scrollbar-track: transparent;
        --scrollbar-thumb: rgba(105, 163, 232, 0.42);
        --scrollbar-thumb-hover: rgba(5, 88, 242, 0.62);
    }

    html,
    body,
    #app {
        height: 100%;
        overflow: hidden;
        margin: 0;
        padding: 0;
        font-family:
            'JetBrains Maple Mono',
            -apple-system,
            BlinkMacSystemFont,
            'Segoe UI',
            Roboto,
            'PingFang SC',
            'Hiragino Sans GB',
            'Microsoft YaHei',
            sans-serif;
        background: var(--color-bg);
        color: var(--color-text-secondary);
    }
    * {
        box-sizing: border-box;
        scrollbar-width: thin;
        scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
    }
    *::-webkit-scrollbar {
        width: var(--scrollbar-size);
        height: var(--scrollbar-size);
    }
    *::-webkit-scrollbar-track {
        background: var(--scrollbar-track);
    }
    *::-webkit-scrollbar-thumb {
        min-height: 40px;
        background: var(--scrollbar-thumb);
        background-clip: content-box;
        border: 3px solid transparent;
        border-radius: 999px;
    }
    *::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-thumb-hover);
        background-clip: content-box;
    }
    *::-webkit-scrollbar-corner,
    *::-webkit-scrollbar-button {
        display: none;
        width: 0;
        height: 0;
    }
    .layout {
        width: 100vw;
        height: 100dvh;
        min-height: 0;
        overflow: hidden;
        background: var(--color-bg);
    }
    .aside {
        width: 200px;
        background: var(--color-panel-dark);
        color: var(--color-text-inverse);
        display: flex;
        flex-direction: column;
        flex: 0 0 200px;
        min-height: 0;
        overflow: hidden;
    }
    .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(210, 217, 245, 0.16);
    }
    .brand-logo {
        width: 32px;
        height: 32px;
        border-radius: 6px;
        object-fit: cover;
        flex-shrink: 0;
    }
    .brand-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .brand-title {
        display: block;
        font-size: 18px;
        font-weight: 600;
        color: var(--color-text-inverse);
    }
    .brand-sub {
        display: block;
        font-size: 12px;
        color: var(--color-border-strong);
        margin-top: 4px;
    }
    .menu {
        --el-menu-hover-bg-color: rgba(105, 163, 232, 0.16);
        --el-menu-hover-text-color: var(--color-text-inverse);

        background: transparent;
        border: none;
        flex: 1;
        min-height: 0;
        overflow: auto;
        scrollbar-width: none;
    }
    .menu::-webkit-scrollbar {
        display: none;
    }
    .content-shell {
        min-width: 0;
        min-height: 0;
        overflow: hidden;
    }
    .menu.el-menu {
        background: transparent;
    }
    .el-menu--vertical .el-menu-item {
        color: var(--color-border);
    }
    .el-menu--vertical .el-menu-item:not(.is-active):hover,
    .el-menu--vertical .el-menu-item:not(.is-active):focus {
        color: var(--color-text-inverse);
        background: rgba(105, 163, 232, 0.16);
    }
    .el-menu--vertical .el-menu-item.is-active {
        color: var(--color-text-inverse);
        background: var(--color-primary);
    }
    .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 56px;
        background: var(--color-card);
        border-bottom: 1px solid var(--color-border);
        padding: 0 20px;
        flex: 0 0 56px;
        gap: 12px;
    }
    .header-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--color-text-primary);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .header-status {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
    }
    .header-host {
        color: var(--color-text-muted);
        font-size: 13px;
    }

    .main-content {
        background: var(--color-bg);
        min-height: 0;
        overflow: hidden;
        padding: 16px;
    }

    .page {
        height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
    }

    .page-scroll {
        overflow: auto;
        scrollbar-gutter: stable;
    }

    .table-page {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .table-card {
        display: flex;
        flex: 1;
        min-height: 0;
    }

    .table-card > .el-card__body {
        display: flex;
        flex: 1;
        min-width: 0;
        min-height: 0;
        flex-direction: column;
        overflow: hidden;
    }

    .table-card .el-table {
        flex: 1;
        min-height: 0;
    }

    .page .el-row {
        row-gap: 16px;
    }

    .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .el-card {
        min-width: 0;
        overflow: hidden;
    }

    .el-card {
        border-color: var(--color-border);
    }

    .el-table {
        --el-table-header-bg-color: var(--color-primary-soft);
        --el-table-header-text-color: var(--color-text-secondary);
        --el-table-border-color: var(--color-border);
        --el-table-tr-bg-color: var(--color-card);
        --el-scrollbar-bg-color: var(--scrollbar-thumb);
        --el-scrollbar-hover-bg-color: var(--scrollbar-thumb-hover);
    }

    .el-scrollbar__bar.is-horizontal {
        height: 8px;
    }

    .el-scrollbar__bar.is-vertical {
        width: 8px;
    }

    .el-scrollbar__thumb {
        opacity: 0.72;
        border-radius: 999px;
    }

    .el-scrollbar__thumb:hover {
        opacity: 1;
    }

    .el-table .cell {
        word-break: break-word;
    }

    @media (max-width: 900px) {
        .layout {
            flex-direction: column;
        }

        .aside {
            width: 100%;
            flex: 0 0 auto;
            min-height: auto;
        }

        .brand {
            height: 54px;
            padding: 10px 14px;
        }

        .brand-logo {
            width: 28px;
            height: 28px;
        }

        .brand-title {
            font-size: 16px;
        }

        .brand-sub {
            display: none;
        }

        .menu {
            width: 100%;
            flex: 0 0 auto;
            display: flex;
            overflow-x: auto;
            overflow-y: hidden;
            white-space: nowrap;
        }

        .menu.el-menu--vertical {
            flex-direction: row;
        }

        .menu.el-menu--vertical .el-menu-item {
            height: 44px;
            flex: 0 0 auto;
            padding: 0 14px;
        }

        .content-shell {
            flex: 1;
        }

        .header {
            height: 48px;
            flex-basis: 48px;
            padding: 0 14px;
        }

        .main-content {
            padding: 12px;
        }

        .page .el-col {
            max-width: 50%;
            flex: 0 0 50%;
        }

        .table-page .el-col {
            max-width: 100%;
            flex: 0 0 100%;
        }

        .el-dialog {
            --el-dialog-width: calc(100vw - 24px) !important;
        }
    }

    @media (max-width: 640px) {
        .header-host {
            display: none;
        }

        .page .el-col {
            max-width: 100%;
            flex: 0 0 100%;
        }

        .table-page {
            overflow: hidden;
        }

        .el-form-item {
            display: block;
        }

        .el-form-item__label {
            width: auto !important;
            justify-content: flex-start;
            margin-bottom: 6px;
        }

        .el-form-item__content {
            margin-left: 0 !important;
            min-width: 0;
        }

        .el-select,
        .el-input,
        .el-input-number,
        .el-radio-group {
            max-width: 100%;
        }

        .el-radio-group {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .el-radio-button__inner {
            border-left: var(--el-border) !important;
            border-radius: var(--el-border-radius-base) !important;
        }

        .el-drawer.rtl {
            width: 100% !important;
        }
    }
</style>
