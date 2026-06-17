/**
 * 类型化访问 window.gateway。
 */

export type IpcResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: { message: string; code: string } }

async function call<T>(p: Promise<IpcResult<T>>): Promise<T> {
    const r = await p
    if (!r.ok) throw new Error(r.error.message)
    return r.data
}

export const api = {
    settings: {
        get: () => call(window.gateway.settings.get()),
        update: (payload: any) => call(window.gateway.settings.update(payload)),
        setToken: (token: string) => call(window.gateway.settings.setToken(token)),
        revealToken: () => call(window.gateway.settings.revealToken()),
    },
    keys: {
        list: () => call(window.gateway.keys.list()),
        add: (payload: { name: string; key: string; weight?: number }) =>
            call(window.gateway.keys.add(payload)),
        remove: (id: string) => call(window.gateway.keys.remove(id)),
        setEnabled: (id: string, enabled: boolean) =>
            call(window.gateway.keys.setEnabled(id, enabled)),
        setWeight: (id: string, weight: number) => call(window.gateway.keys.setWeight(id, weight)),
        rename: (id: string, name: string) => call(window.gateway.keys.rename(id, name)),
        reset: (id: string) => call(window.gateway.keys.reset(id)),
        test: (id: string) => call(window.gateway.keys.test(id)),
        goUsage: (id: string) => call(window.gateway.keys.goUsage(id)),
    },
    usage: {
        summary: (win: '5h' | '7d' | '30d') => call(window.gateway.usage.summary(win)),
        list: (payload?: { limit?: number; model?: string; keyId?: string }) =>
            call(window.gateway.usage.list(payload)),
        detail: (id: string) => call(window.gateway.usage.detail(id)),
    },
    gateway: {
        status: () => call(window.gateway.gateway.status()),
        restart: () => call(window.gateway.gateway.restart()),
    },
    app: {
        openDataDir: () => call(window.gateway.app.openDataDir()),
    },
    models: {
        list: () => call(window.gateway.models.list()),
        add: (payload: { id: string; upstreamUrl: string }) =>
            call(window.gateway.models.add(payload)),
        remove: (id: string) => call(window.gateway.models.remove(id)),
        setEnabled: (id: string, enabled: boolean) =>
            call(window.gateway.models.setEnabled(id, enabled)),
        update: (payload: { id: string; upstreamUrl: string }) =>
            call(window.gateway.models.update(payload)),
        syncFromDocs: () => call(window.gateway.models.syncFromDocs()),
    },
    test: {
        runModel: (payload: {
            model: string
            prompt: string
            keyId?: string
            apiKey?: string
            stream?: boolean
            maxTokens?: number
        }) => call(window.gateway.test.runModel(payload)),
    },
}
