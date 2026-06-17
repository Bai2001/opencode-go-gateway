import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        build: {
            lib: {
                entry: resolve(__dirname, 'src/main/index.ts'),
            },
            outDir: 'out/main',
            rollupOptions: {
                output: {
                    format: 'cjs',
                },
            },
        },
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            lib: {
                entry: resolve(__dirname, 'src/preload/index.ts'),
            },
            outDir: 'out/preload',
            rollupOptions: {
                output: {
                    format: 'cjs',
                },
            },
        },
    },
    renderer: {
        root: resolve(__dirname, 'src/renderer'),
        plugins: [vue()],
        build: {
            outDir: 'out/renderer',
            rollupOptions: {
                input: resolve(__dirname, 'src/renderer/index.html'),
            },
        },
        resolve: {
            alias: {
                '@': resolve(__dirname, 'src/renderer/src'),
            },
        },
    },
})
