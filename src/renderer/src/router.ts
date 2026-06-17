import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from './pages/Dashboard.vue'
import Keys from './pages/Keys.vue'
import Models from './pages/Models.vue'
import Usage from './pages/Usage.vue'
import Logs from './pages/Logs.vue'
import Settings from './pages/Settings.vue'
import TestModel from './pages/TestModel.vue'

export const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: '/', redirect: '/dashboard' },
        { path: '/dashboard', component: Dashboard, meta: { title: '概览' } },
        { path: '/keys', component: Keys, meta: { title: 'Key 管理' } },
        { path: '/models', component: Models, meta: { title: '模型配置' } },
        { path: '/usage', component: Usage, meta: { title: '用量' } },
        { path: '/logs', component: Logs, meta: { title: '日志' } },
        { path: '/settings', component: Settings, meta: { title: '设置' } },
        { path: '/test', component: TestModel, meta: { title: '测试模型' } },
    ],
})
