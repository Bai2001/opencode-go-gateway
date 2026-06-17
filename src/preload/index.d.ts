export {}

declare global {
    interface Window {
        gateway: {
            settings: {
                get: () => Promise<
                    | { ok: true; data: any }
                    | { ok: false; error: { message: string; code: string } }
                >
                update: (
                    payload: any
                ) => Promise<
                    | { ok: true; data: boolean }
                    | { ok: false; error: { message: string; code: string } }
                >
                setToken: (
                    token: string
                ) => Promise<
                    | { ok: true; data: boolean }
                    | { ok: false; error: { message: string; code: string } }
                >
                revealToken: () => Promise<
                    | { ok: true; data: string }
                    | { ok: false; error: { message: string; code: string } }
                >
            }
            keys: {
                list: () => Promise<
                    | { ok: true; data: any[] }
                    | { ok: false; error: { message: string; code: string } }
                >
                add: (payload: {
                    name: string
                    key: string
                    weight?: number
                }) => Promise<
                    | { ok: true; data: any }
                    | { ok: false; error: { message: string; code: string } }
                >
                remove: (
                    id: string
                ) => Promise<
                    | { ok: true; data: boolean }
                    | { ok: false; error: { message: string; code: string } }
                >
                setEnabled: (
                    id: string,
                    enabled: boolean
                ) => Promise<
                    | { ok: true; data: boolean }
                    | { ok: false; error: { message: string; code: string } }
                >
                setWeight: (
                    id: string,
                    weight: number
                ) => Promise<
                    | { ok: true; data: boolean }
                    | { ok: false; error: { message: string; code: string } }
                >
                rename: (
                    id: string,
                    name: string
                ) => Promise<
                    | { ok: true; data: boolean }
                    | { ok: false; error: { message: string; code: string } }
                >
                reset: (
                    id: string
                ) => Promise<
                    | { ok: true; data: boolean }
                    | { ok: false; error: { message: string; code: string } }
                >
                test: (
                    id: string
                ) => Promise<
                    | { ok: true; data: any }
                    | { ok: false; error: { message: string; code: string } }
                >
                goUsage: (
                    id: string
                ) => Promise<
                    | { ok: true; data: any }
                    | { ok: false; error: { message: string; code: string } }
                >
            }
            usage: {
                summary: (
                    window: '5h' | '7d' | '30d'
                ) => Promise<
                    | { ok: true; data: any }
                    | { ok: false; error: { message: string; code: string } }
                >
                list: (payload?: {
                    limit?: number
                    model?: string
                    keyId?: string
                }) => Promise<
                    | { ok: true; data: any[] }
                    | { ok: false; error: { message: string; code: string } }
                >
                detail: (
                    id: string
                ) => Promise<
                    | { ok: true; data: any }
                    | { ok: false; error: { message: string; code: string } }
                >
            }
            gateway: {
                status: () => Promise<
                    | { ok: true; data: any }
                    | { ok: false; error: { message: string; code: string } }
                >
                restart: () => Promise<
                    | { ok: true; data: boolean }
                    | { ok: false; error: { message: string; code: string } }
                >
            }
            app: {
                openDataDir: () => Promise<
                    | { ok: true; data: boolean }
                    | { ok: false; error: { message: string; code: string } }
                >
            }
            models: {
                list: () => Promise<
                    | { ok: true; data: any[] }
                    | { ok: false; error: { message: string; code: string } }
                >
                add: (payload: {
                    id: string
                    upstreamUrl: string
                }) => Promise<
                    | { ok: true; data: boolean }
                    | { ok: false; error: { message: string; code: string } }
                >
                remove: (
                    id: string
                ) => Promise<
                    | { ok: true; data: boolean }
                    | { ok: false; error: { message: string; code: string } }
                >
                setEnabled: (
                    id: string,
                    enabled: boolean
                ) => Promise<
                    | { ok: true; data: boolean }
                    | { ok: false; error: { message: string; code: string } }
                >
                update: (payload: {
                    id: string
                    upstreamUrl: string
                }) => Promise<
                    | { ok: true; data: boolean }
                    | { ok: false; error: { message: string; code: string } }
                >
                syncFromDocs: () => Promise<
                    | { ok: true; data: any[] }
                    | { ok: false; error: { message: string; code: string } }
                >
            }
            test: {
                runModel: (payload: {
                    model: string
                    prompt: string
                    keyId?: string
                    apiKey?: string
                    stream?: boolean
                    maxTokens?: number
                }) => Promise<
                    | { ok: true; data: any }
                    | { ok: false; error: { message: string; code: string } }
                >
            }
        }
    }
}
