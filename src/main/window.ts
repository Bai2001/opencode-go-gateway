import { BrowserWindow, shell, app } from 'electron'
import { join } from 'node:path'
import { store } from './store/json-store'

let mainWindow: BrowserWindow | null = null

function getAppIconPath() {
    return app.isPackaged
        ? join(app.getAppPath(), 'out', 'renderer', 'logo.png')
        : join(__dirname, '../../src/renderer/public/logo.png')
}

export function createMainWindow() {
    if (mainWindow) return mainWindow
    const preload = join(__dirname, '../preload/index.js')
    const indexHtml = join(__dirname, '../renderer/index.html')

    mainWindow = new BrowserWindow({
        width: 1100,
        height: 720,
        minWidth: 900,
        minHeight: 600,
        show: false,
        autoHideMenuBar: true,
        title: 'OpenCode Go Gateway',
        icon: getAppIconPath(),
        webPreferences: {
            preload,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
        },
    })

    mainWindow.on('closed', () => {
        mainWindow = null
    })

    mainWindow.on('ready-to-show', () => {
        const s = store.cache
        if (s && !s.settings.startup.startMinimized) {
            mainWindow?.show()
        }
    })

    mainWindow.webContents.setWindowOpenHandler(details => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    if (process.env.ELECTRON_RENDERER_URL) {
        mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
        mainWindow.loadFile(indexHtml)
    }

    return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
    return mainWindow
}

export function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        mainWindow = createMainWindow()
    }
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
    }
}

export function closeMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close()
    }
    mainWindow = null
}
