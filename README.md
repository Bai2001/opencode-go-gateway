# OpenCode Go Gateway

OpenCode Go Gateway 是一个本地运行的 OpenAI 兼容 API 网关，用于统一管理多个 OpenCode Go Key，并通过桌面应用提供 Key 管理、模型配置、请求日志和用量统计能力。

## 特性

- **OpenAI 兼容接口：** 提供 `/v1/chat/completions` 和 `/v1/models`，方便接入支持 OpenAI API 的客户端。
- **多 Key 管理：** 支持添加、启停、重命名、权重配置、状态重置和可用性测试。
- **自动 Key 选择：** 根据 Key 状态、失败记录和用量信息选择可用 Key，并在部分失败场景自动重试。
- **模型配置：** 支持同步 OpenCode Go 官方文档中的模型信息，也可以添加自定义模型路由。
- **用量统计：** 记录请求、Token、预估成本、延迟、上游响应和失败原因。
- **请求日志：** 保存客户端请求、上游请求、上游响应和网关响应摘要，便于排查问题。
- **桌面管理界面：** 基于 Electron + Vue 3 + Element Plus，提供可视化操作入口。

## 技术栈

- Electron
- electron-vite
- Vue 3
- Element Plus
- Fastify
- TypeScript
- better-sqlite3

## 快速开始

### 环境要求

- Node.js（建议使用当前 LTS 版本或更高版本）
- npm 11 或更高版本
- Windows、macOS 或 Linux 桌面环境

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

启动后会打开桌面应用，并在本地启动网关服务。默认监听地址为：

```text
http://127.0.0.1:8910
```

### 类型检查

```bash
npm run typecheck
```

### 构建应用

```bash
npm run build
```

### 打包 Windows 安装包

```bash
npm run package:win
```

打包产物默认输出到 `release` 目录。

## 使用说明

### 1. 添加 OpenCode Go Key

打开桌面应用后，进入「Key 管理」页面，添加一个或多个 OpenCode Go Key。添加后可以在页面中测试 Key 是否可用。

### 2. 配置模型

进入「模型配置」页面，可以：

- 从 OpenCode Go 官方文档同步模型信息；
- 启用或禁用内置模型；
- 添加自定义模型 ID 和上游地址。

### 3. 调用本地网关

网关提供 OpenAI 兼容接口。示例请求：

```bash
curl http://127.0.0.1:8910/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model-id",
    "messages": [
      { "role": "user", "content": "你好" }
    ]
  }'
```

如果在「设置」中启用了 Gateway Token，需要额外传入：

```bash
-H "Authorization: Bearer your-gateway-token"
```

### 4. 查看用量与日志

- 「用量」页面用于查看请求数、Token、预估成本和按 Key / 模型聚合的数据。
- 「日志」页面用于查看单次请求的客户端请求、上游请求、上游响应和错误信息。
- 「测试模型」页面可以直接选择模型和 Key 发起测试请求。

## API 端点

| 方法 | 路径                   | 说明                    |
| ---- | ---------------------- | ----------------------- |
| GET  | `/health`              | 健康检查                |
| GET  | `/v1/models`           | 获取可用模型列表        |
| POST | `/v1/chat/completions` | OpenAI 兼容聊天补全接口 |

## 数据存储

应用数据保存在 Electron 的 `userData` 目录中。不同平台路径由 Electron 自动决定，例如：

- Windows：`%APPDATA%/opencode-go-openai-gateway`
- macOS：`~/Library/Application Support/opencode-go-openai-gateway`
- Linux：`~/.config/opencode-go-openai-gateway`

主要数据包括：

- `config.json`：应用设置、Key 配置、模型配置等；
- `usage.db`：请求日志与用量数据。

敏感 Key 会加密保存，界面和日志中只展示脱敏后的预览信息。

## 项目结构

```text
src/
  main/              Electron 主进程、网关服务、存储和业务逻辑
    gateway/         上游请求、模型路由和文档同步
    keys/            Key 池、选择策略和可用性测试
    security/        加密与 Token 处理
    server/          Fastify 服务和 OpenAI 兼容路由
    store/           JSON / SQLite 存储
    usage/           请求捕获、用量统计和成本估算
  preload/           安全暴露给渲染进程的 IPC API
  renderer/          Vue 桌面管理界面
  shared/            主进程、预加载和渲染进程共享类型
```

## 常用脚本

| 命令                     | 说明                                  |
| ------------------------ | ------------------------------------- |
| `npm run dev`            | 启动开发环境                          |
| `npm run build`          | 构建应用                              |
| `npm run start`          | 预览构建结果                          |
| `npm run typecheck`      | 执行主进程和渲染进程类型检查          |
| `npm run typecheck:node` | 仅检查 Node / Electron 主进程相关代码 |
| `npm run typecheck:web`  | 仅检查 Web / Vue 相关代码             |
| `npm run package:win`    | 构建并打包 Windows NSIS 安装包        |

## 安全说明

- 默认只监听 `127.0.0.1:8910`，避免直接暴露到局域网。
- 如需开启局域网访问，请同时配置 Gateway Token，并确保网络环境可信。
- 日志会尽量脱敏敏感 Header 和 Key 信息，但仍建议不要在不可信环境中分享完整数据目录。

## 许可证

本项目使用 MIT 许可证。
