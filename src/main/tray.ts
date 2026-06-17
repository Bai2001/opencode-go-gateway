import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'node:path'
import { showMainWindow } from './window'
import { gatewayServer } from './server'

let tray: Tray | null = null

export function createTray() {
    if (tray) return tray
    const iconPath = app.isPackaged
        ? join(app.getAppPath(), 'out', 'renderer', 'logo.png')
        : join(__dirname, '../../src/renderer/public/logo.png')
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    tray = new Tray(icon)
    tray.setToolTip('OpenCode Go Gateway')
    refreshTrayMenu()
    tray.on('click', () => {
        showMainWindow()
    })
    return tray
}

export function refreshTrayMenu() {
    if (!tray) return
    const status = gatewayServer.status()
    const statusLabel = status.running ? `运行中：${status.host}:${status.port}` : '未启动'
    const menu = Menu.buildFromTemplate([
        { label: statusLabel, enabled: false },
        { type: 'separator' },
        { label: '打开主面板', click: () => showMainWindow() },
        { type: 'separator' },
        {
            label: '退出',
            click: () => {
                app.quit()
            },
        },
    ])
    tray.setContextMenu(menu)
}

export function destroyTray() {
    if (tray) {
        tray.destroy()
        tray = null
    }
}
