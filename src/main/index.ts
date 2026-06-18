import { app, BrowserWindow } from 'electron'
import { store } from './store/json-store'
import { usageStore } from './store/usage-store'
import { gatewayServer } from './server'
import { createMainWindow, showMainWindow } from './window'
import { createTray, destroyTray, refreshTrayMenu } from './tray'
import { registerIpc } from './ipc'
import { modelRouter } from './gateway/model-router'

/**
 * Electron Main 进程入口。
 *
 * 启动顺序：
 *   1. app ready
 *   2. 初始化 store
 *   3. 把 config.json 中残留的 usage 迁移到 SQLite，并清空 JSON
 *   4. 注册 IPC
 *   5. 启动 GatewayServer
 *   6. 创建窗口 + 托盘
 */

let quitting = false

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
    app.quit()
} else {
    app.on('second-instance', () => {
        showMainWindow()
    })

    app.whenReady().then(async () => {
        await store.load()
        // 一次性迁移：把 JSON 中的 usage 导入 SQLite，成功后从 config.json 清空
        try {
            const legacy = await store.consumeUsage()
            if (legacy.length > 0) {
                const inserted = usageStore.migrateFromRecords(legacy)
                console.log(`[migrate] 已把 ${inserted}/${legacy.length} 条 usage 迁移到 SQLite`)
            }
        } catch (e: any) {
            console.error('[migrate] usage 迁移失败：', e?.message ?? e)
        }
        modelRouter.reload()

        registerIpc()
        try {
            await gatewayServer.start()
        } catch (e: any) {
            console.error('[gateway] 启动失败：', e?.message ?? e)
        }
        createMainWindow()
        createTray()
        refreshTrayMenu()
    })

    app.on('window-all-closed', () => {
        // 默认 macOS 不退出；其他平台也不退出，靠托盘
        if (process.platform !== 'darwin') {
            // 不退出 app，保持托盘
        }
    })

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow()
        } else {
            showMainWindow()
        }
    })

    app.on('before-quit', () => {
        quitting = true
        destroyTray()
    })

    app.on('will-quit', async () => {
        await gatewayServer.stop()
        usageStore.close()
    })
}

export { quitting }
