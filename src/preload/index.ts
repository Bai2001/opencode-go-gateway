import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload：暴露 window.gateway 给 Renderer。
 * 文档 4.3 / 14.4：只暴露具体方法，不暴露通用 IPC。
 */

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { message: string; code: string } }

function invoke<T = any>(channel: string, payload?: any): Promise<IpcResult<T>> {
    return ipcRenderer.invoke(channel, payload)
}

const api = {
    settings: {
        get: () => invoke('settings:get'),
        update: (payload: any) => invoke('settings:update', payload),
        setToken: (token: string) => invoke('settings:setToken', { token }),
        revealToken: () => invoke<string>('settings:revealToken'),
    },
    keys: {
        list: () => invoke<any[]>('keys:list'),
        add: (payload: { name: string; key: string; weight?: number }) =>
            invoke('keys:add', payload),
        remove: (id: string) => invoke('keys:remove', { id }),
        setEnabled: (id: string, enabled: boolean) => invoke('keys:setEnabled', { id, enabled }),
        setWeight: (id: string, weight: number) => invoke('keys:setWeight', { id, weight }),
        rename: (id: string, name: string) => invoke('keys:rename', { id, name }),
        reset: (id: string) => invoke('keys:reset', { id }),
        test: (id: string) => invoke('keys:test', { id }),
        goUsage: (id: string) => invoke('keys:goUsage', { id }),
    },
    usage: {
        summary: (window: '5h' | '7d' | '30d') => invoke('usage:summary', { window }),
        list: (payload: { limit?: number; model?: string; keyId?: string } = {}) =>
            invoke('usage:list', payload),
        detail: (id: string) => invoke('usage:detail', { id }),
    },
    gateway: {
        status: () => invoke<any>('gateway:status'),
        restart: () => invoke('gateway:restart'),
    },
    app: {
        openDataDir: () => invoke('app:openDataDir'),
    },
    models: {
        list: () => invoke<any[]>('models:list'),
        add: (payload: { id: string; upstreamUrl: string }) => invoke('models:add', payload),
        remove: (id: string) => invoke('models:remove', { id }),
        setEnabled: (id: string, enabled: boolean) => invoke('models:setEnabled', { id, enabled }),
        update: (payload: { id: string; upstreamUrl: string }) => invoke('models:update', payload),
        syncFromDocs: () => invoke<any[]>('models:syncFromDocs'),
    },
    test: {
        runModel: (payload: {
            model: string
            prompt: string
            keyId?: string
            apiKey?: string
            stream?: boolean
            maxTokens?: number
        }) => invoke('test:runModel', payload),
    },
}

if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('gateway', api)
    } catch (e) {
        console.error('[preload] expose failed', e)
    }
} else {
    // @ts-ignore
    window.gateway = api
}
