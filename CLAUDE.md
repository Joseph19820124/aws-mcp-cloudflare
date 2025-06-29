# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 项目概述

此代码库包含一个从 STDIO 通信迁移到服务器发送事件 (SSE) 并部署在 Cloudflare Workers 上的 AWS 文档 MCP 服务器。主项目位于 `aws-docs-mcp-cloudflare/` 目录中。

## 开发命令

```bash
# 本地开发
cd aws-docs-mcp-cloudflare
npm install
npm run dev              # 在 localhost:8787 启动本地开发服务器

# 构建和验证
npm run build           # TypeScript 编译
npm run lint            # ESLint 代码检查
npm run format          # Prettier 代码格式化

# 部署
npm run deploy:dev      # 部署到开发环境
npm run deploy:prod     # 部署到生产环境

# Cloudflare Workers 特定命令
npx wrangler tail --env production    # 查看实时日志
npx wrangler metrics --env production # 性能指标
```

## 架构

代码库采用模块化架构：

- **`src/index.ts`**: 主 Hono 应用，包含 HTTP 端点和 SSE 连接管理
- **`src/mcp-sse-adapter.ts`**: 将 MCP 协议转换为服务器发送事件
- **`src/aws-docs-handler.ts`**: 处理 AWS 文档请求和工具调用
- **`src/types.ts`**: MCP 协议和 SSE 消息的 TypeScript 类型定义
- **`client/sse-mcp-client.ts`**: 连接到基于 SSE 的 MCP 服务器的 TypeScript 客户端

### 关键组件

1. **SSE 适配器**: 处理连接生命周期、消息路由和协议转换
2. **AWS 文档处理器**: 实现核心 AWS 文档工具（读取、搜索、推荐、列出服务）
3. **连接管理**: 通过 ping/pong 保活机制跟踪活动连接
4. **全球边缘部署**: 在 Cloudflare Workers 上运行，实现低于 100ms 的全球延迟

## 配置

环境变量在 `wrangler.toml` 中配置：
- `AWS_DOCUMENTATION_PARTITION`: "aws"（全球）或 "aws-cn"（中国）
- `FASTMCP_LOG_LEVEL`: 日志详细程度（ERROR、WARN、INFO、DEBUG）

服务器根据分区支持不同的功能集：
- **全球 (aws)**: 包含搜索和推荐的完整功能集
- **中国 (aws-cn)**: 仅支持文档读取和服务列出

## 测试

服务器提供多个端点用于健康检查和调试：
- `GET /health` - 包含分区信息的健康检查
- `GET /capabilities` - 服务器功能
- `GET /mcp/connections` - 活动连接状态
- `POST /mcp/cleanup` - 强制清理连接

使用 TypeScript 客户端（`client/sse-mcp-client.ts`）进行集成测试，或使用 README 中的 cURL 示例进行手动测试。

## 技术栈

- **运行时**: Cloudflare Workers，支持 Node.js 兼容性
- **框架**: Hono.js 用于 HTTP 处理
- **协议**: 基于服务器发送事件的 JSON-RPC
- **构建**: TypeScript，目标为 es2022
- **部署**: Wrangler CLI 用于 Cloudflare Workers