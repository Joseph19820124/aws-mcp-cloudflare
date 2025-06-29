# 🚀 完整部署指南

## 部署到 Cloudflare Workers

### 第1步：环境准备

```bash
# 安装依赖
npm install

# 登录 Cloudflare（如果还没有登录）
npx wrangler login
```

### 第2步：配置检查

确保 `wrangler.toml` 配置正确：

```toml
name = "aws-docs-mcp-server"
main = "src/index.ts"
compatibility_date = "2024-01-01" 
compatibility_flags = ["nodejs_compat"]

[env.development]
name = "aws-docs-mcp-server-dev"

[env.production]
name = "aws-docs-mcp-server-prod"

[vars]
AWS_DOCUMENTATION_PARTITION = "aws"  # 或 "aws-cn" 用于中国区
FASTMCP_LOG_LEVEL = "ERROR"
```

### 第3步：开发环境部署

```bash
# 部署到开发环境
npm run deploy:dev

# 或者手动部署
npx wrangler deploy --env development
```

部署成功后，你会得到类似这样的URL：
```
https://aws-docs-mcp-server-dev.your-subdomain.workers.dev
```

### 第4步：生产环境部署

```bash
# 部署到生产环境
npm run deploy:prod

# 或者手动部署
npx wrangler deploy --env production
```

### 第5步：验证部署

```bash
# 测试健康检查
curl https://aws-docs-mcp-server-prod.your-subdomain.workers.dev/health

# 测试能力查询
curl https://aws-docs-mcp-server-prod.your-subdomain.workers.dev/capabilities

# 测试工具列表
curl -X POST https://aws-docs-mcp-server-prod.your-subdomain.workers.dev/mcp/message \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

## 🔧 高级配置

### 自定义域名

1. 在 Cloudflare Dashboard 中添加自定义域名
2. 更新 `wrangler.toml`：

```toml
[env.production]
name = "aws-docs-mcp-server-prod"
routes = [
  { pattern = "mcp.yourdomain.com/*", custom_domain = true }
]
```

3. 重新部署：
```bash
npx wrangler deploy --env production
```

### 环境变量配置

对于敏感配置，使用 Cloudflare 的加密环境变量：

```bash
# 设置生产环境变量
npx wrangler secret put API_KEY --env production

# 设置开发环境变量  
npx wrangler secret put API_KEY --env development
```

### 缓存策略优化

在代码中添加缓存控制：

```typescript
// 在响应中添加缓存头
response.headers.set('Cache-Control', 'public, max-age=3600');
response.headers.set('CDN-Cache-Control', 'public, max-age=86400');
```

## 📊 监控和日志

### 实时日志

```bash
# 查看生产环境日志
npx wrangler tail --env production

# 查看开发环境日志
npx wrangler tail --env development

# 过滤特定日志级别
npx wrangler tail --env production --level error
```

### 性能指标

```bash
# 查看性能指标
npx wrangler metrics --env production

# 查看特定时间段指标
npx wrangler metrics --env production --since 2024-01-01
```

### 错误监控

设置错误处理和监控：

```typescript
// 在代码中添加错误上报
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  // 可以集成第三方错误监控服务
  return c.json({ error: 'Internal Server Error' }, 500);
});
```

## 🔐 安全配置

### CORS 策略

根据需要调整 CORS 配置：

```typescript
app.use('/*', cors({
  origin: ['https://yourdomain.com', 'https://app.yourdomain.com'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  maxAge: 86400,
}));
```

### 速率限制

利用 Cloudflare 的速率限制功能：

1. 在 Cloudflare Dashboard 中设置速率限制规则
2. 或者在代码中实现：

```typescript
// 简单的速率限制实现
const rateLimiter = new Map();

app.use('/mcp/*', async (c, next) => {
  const clientIP = c.req.header('CF-Connecting-IP') || 'unknown';
  const key = `rate_limit:${clientIP}`;
  
  // 实现速率限制逻辑
  await next();
});
```

## 💰 成本优化

### Cloudflare Workers 定价

| 套餐 | 免费额度 | 超出费用 |
|------|----------|----------|
| 请求数 | 100,000/天 | $0.50/百万请求 |
| CPU时间 | 10ms/请求 | $12.50/百万CPU秒 |
| 出站流量 | 无限制 | 免费 |

### 优化建议

1. **缓存静态内容**：减少重复计算
2. **优化代码**：减少 CPU 使用时间
3. **批量处理**：减少请求数量
4. **压缩响应**：减少传输成本

## 🔄 CI/CD 集成

### GitHub Actions

创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run tests
        run: npm test
        
      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          environment: 'production'
```

### 设置 Secrets

在 GitHub 仓库设置中添加：
- `CLOUDFLARE_API_TOKEN`：Cloudflare API 令牌

## 🧪 测试部署

### 自动化测试

创建测试脚本：

```bash
#!/bin/bash
# test-deployment.sh

BASE_URL="https://your-worker.workers.dev"

echo "🧪 Testing deployment at $BASE_URL"

# 测试健康检查
echo "Testing /health..."
curl -f "$BASE_URL/health" || exit 1

# 测试 MCP 功能
echo "Testing MCP tools/list..."
curl -f -X POST "$BASE_URL/mcp/message" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' || exit 1

echo "✅ All tests passed!"
```

### 负载测试

使用工具进行负载测试：

```bash
# 使用 wrk 进行负载测试
wrk -t12 -c400 -d30s --script=post.lua https://your-worker.workers.dev/mcp/message

# 使用 ab 进行简单测试
ab -n 1000 -c 10 https://your-worker.workers.dev/health
```

## 🚨 故障排除

### 常见部署问题

1. **部署失败**
   ```bash
   # 检查 wrangler 配置
   npx wrangler whoami
   npx wrangler dev --dry-run
   ```

2. **运行时错误**
   ```bash
   # 查看详细日志
   npx wrangler tail --env production --level error
   ```

3. **性能问题**
   ```bash
   # 检查 CPU 使用率
   npx wrangler metrics --env production
   ```

### 回滚策略

```bash
# 查看部署历史
npx wrangler deployments list

# 回滚到之前的版本
npx wrangler rollback [DEPLOYMENT_ID]
```

## 📈 扩展和维护

### 版本管理

- 使用语义化版本控制
- 在 `package.json` 中更新版本号
- 创建 git 标签

### 功能扩展

1. **添加新工具**：在 `AWSDocsHandler` 中添加新方法
2. **优化缓存**：实现更智能的缓存策略
3. **监控增强**：集成 APM 工具

### 定期维护

- 监控性能指标
- 更新依赖包
- 优化代码性能
- 备份配置数据

---

**🎉 部署完成！你的 AWS MCP 服务器现在运行在全球边缘网络上！**