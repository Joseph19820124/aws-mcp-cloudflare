# 📋 AWS MCP SSE版本技术规格说明书

## 🎯 文档概述

### 文档目的
本技术规格说明书定义了AWS MCP服务器从STDIO协议迁移到Server-Sent Events (SSE)协议的详细技术实现规范，为开发团队提供准确的实现指导。

### 适用范围
- 开发团队：详细的实现规范
- 测试团队：验证标准和测试用例
- 运维团队：部署和监控配置
- 产品团队：功能验收标准

### 技术标准
- MCP协议版本：2024-11-05
- JSON-RPC版本：2.0
- TypeScript版本：5.8+
- ECMAScript目标：ES2022
- HTTP协议版本：HTTP/2, HTTP/3

## 🔧 核心组件技术规格

### 1. MCP-SSE适配器技术规格

#### 类定义和接口
```typescript
interface MCPSSEAdapterConfig {
  maxConnections: number;           // 最大连接数 (默认: 10000)
  pingInterval: number;            // ping间隔 (默认: 30000ms)
  pongTimeout: number;             // pong超时 (默认: 10000ms)
  cleanupInterval: number;         // 清理间隔 (默认: 60000ms)
  messageTimeout: number;          // 消息超时 (默认: 30000ms)
}

interface MessageHandler {
  (message: MCPMessage, connectionId: string): Promise<MCPMessage>;
}

class MCPSSEAdapter {
  private config: MCPSSEAdapterConfig;
  private connections: Map<string, ConnectionState>;
  private handlers: Map<string, MessageHandler>;
  private cleanupTimer?: number;
  
  constructor(config?: Partial<MCPSSEAdapterConfig>);
  
  // 连接管理
  generateConnectionId(): string;
  registerConnection(id: string, partition: 'aws' | 'aws-cn'): void;
  unregisterConnection(id: string): void;
  getConnection(id: string): ConnectionState | undefined;
  getActiveConnections(): ConnectionState[];
  cleanupConnections(): number;
  
  // 消息处理
  registerHandler(method: string, handler: MessageHandler): void;
  unregisterHandler(method: string): void;
  processMessage(message: MCPMessage, connectionId: string): Promise<MCPMessage>;
  
  // SSE消息创建
  createInitMessage(connectionId: string, capabilities: ServerCapabilities): string;
  createPingMessage(connectionId: string): string;
  createDataMessage(connectionId: string, data: MCPMessage): string;
  createErrorMessage(connectionId: string, error: MCPError): string;
  
  // 响应创建
  createSuccessResponse(id: any, result: any): MCPMessage;
  createErrorResponse(id: any, code: number, message: string, data?: any): MCPMessage;
  
  // 连接保活
  handlePong(connectionId: string): void;
  isConnectionAlive(connectionId: string): boolean;
}
```

#### 实现规格
```typescript
// 连接ID生成算法
generateConnectionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2);
  return `conn_${timestamp}_${random}`;
}

// SSE消息格式规范
interface SSEEventData {
  type: 'init' | 'request' | 'response' | 'error' | 'ping' | 'pong';
  id: string;
  timestamp: number;
  data: any;
}

// SSE消息序列化
private formatSSEMessage(event: SSEEventData): string {
  const serialized = JSON.stringify(event);
  return `data: ${serialized}\n\n`;
}
```

#### 错误处理规格
```typescript
enum MCPErrorCodes {
  PARSE_ERROR = -32700,        // JSON解析错误
  INVALID_REQUEST = -32600,     // 无效请求
  METHOD_NOT_FOUND = -32601,    // 方法未找到
  INVALID_PARAMS = -32602,      // 参数无效
  INTERNAL_ERROR = -32603,      // 内部错误
  SERVER_ERROR_START = -32099,  // 服务器错误起始
  SERVER_ERROR_END = -32000,    // 服务器错误结束
}

interface ErrorMapping {
  [key: string]: {
    code: number;
    message: string;
    retry: boolean;
  };
}

const ERROR_MAPPINGS: ErrorMapping = {
  'CONNECTION_TIMEOUT': {
    code: -32001,
    message: 'Connection timeout',
    retry: true
  },
  'RATE_LIMIT_EXCEEDED': {
    code: -32002,
    message: 'Rate limit exceeded',
    retry: false
  },
  'AWS_API_ERROR': {
    code: -32003,
    message: 'AWS API error',
    retry: true
  }
};
```

### 2. AWS文档处理器技术规格

#### 类定义和接口
```typescript
interface AWSDocsHandlerConfig {
  partition: 'aws' | 'aws-cn';
  timeout: number;                 // 请求超时 (默认: 10000ms)
  retryAttempts: number;          // 重试次数 (默认: 3)
  retryDelay: number;             // 重试延迟 (默认: 1000ms)
  cacheEnabled: boolean;          // 缓存启用 (默认: true)
  cacheTTL: number;               // 缓存TTL (默认: 3600000ms)
}

class AWSDocsHandler {
  private config: AWSDocsHandlerConfig;
  private cache: DocumentCache;
  private urlValidator: URLValidator;
  private htmlConverter: HTMLConverter;
  
  constructor(env: Env, config?: Partial<AWSDocsHandlerConfig>);
  
  // MCP处理器
  async handleToolsList(message: MCPMessage): Promise<MCPMessage>;
  async handleToolsCall(message: MCPMessage): Promise<MCPMessage>;
  
  // 工具实现
  async readDocumentation(params: ReadDocumentationParams): Promise<ToolResult>;
  async searchDocumentation(params: SearchDocumentationParams): Promise<ToolResult>;
  async recommend(params: RecommendParams): Promise<ToolResult>;
  async getAvailableServices(params: GetAvailableServicesParams): Promise<ToolResult>;
  
  // 内部方法
  private async fetchDocumentContent(url: string): Promise<string>;
  private async convertHtmlToMarkdown(html: string): Promise<string>;
  private async searchInDocuments(query: string, limit: number): Promise<SearchResult[]>;
  private async findRelatedServices(url: string): Promise<ServiceInfo[]>;
}
```

#### 工具定义规格
```typescript
// 工具列表定义
const TOOL_DEFINITIONS = {
  read_documentation: {
    name: 'read_documentation',
    description: 'Read and return the content of AWS documentation from a given URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL of the AWS documentation page to read',
          pattern: '^https://docs\\.aws(?:ama?zon|rvices)?\\.(?:com|cn)/.+'
        }
      },
      required: ['url']
    }
  },
  
  search_documentation: {
    name: 'search_documentation',
    description: 'Search through AWS documentation using the official search',
    inputSchema: {
      type: 'object',
      properties: {
        search_phrase: {
          type: 'string',
          description: 'The search query for AWS documentation',
          minLength: 1,
          maxLength: 500
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return',
          minimum: 1,
          maximum: 50,
          default: 10
        }
      },
      required: ['search_phrase']
    }
  }
  // ... 其他工具定义
};
```

#### 内容处理规格
```typescript
interface DocumentContent {
  url: string;
  title: string;
  content: string;
  lastModified: string;
  contentType: 'html' | 'markdown';
  metadata: DocumentMetadata;
}

interface DocumentMetadata {
  service: string;
  section: string;
  breadcrumbs: string[];
  lastUpdated: Date;
  version: string;
  tags: string[];
}

class HTMLConverter {
  // HTML到Markdown转换配置
  private conversionOptions = {
    headingStyle: 'atx',        // # 风格标题
    bulletListMarker: '-',      // 列表标记
    codeBlockStyle: 'fenced',   // 代码块风格
    fence: '```',               // 代码围栏
    emDelimiter: '*',           // 强调分隔符
    strongDelimiter: '**',      // 加粗分隔符
    linkStyle: 'inlined',       // 链接风格
    linkReferenceStyle: 'full', // 链接引用风格
  };
  
  async convert(html: string): Promise<string>;
  private cleanupHtml(html: string): string;
  private extractMainContent(html: string): string;
  private processCodeBlocks(markdown: string): string;
  private optimizeForMCP(markdown: string): string;
}
```

### 3. HTTP路由和中间件技术规格

#### 路由定义
```typescript
interface RouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS';
  path: string;
  handler: RouteHandler;
  middleware?: Middleware[];
  rateLimit?: RateLimitConfig;
  cache?: CacheConfig;
}

const ROUTES: RouteDefinition[] = [
  // 健康检查
  {
    method: 'GET',
    path: '/health',
    handler: healthCheckHandler,
    cache: { ttl: 30000 }
  },
  
  // 服务能力
  {
    method: 'GET', 
    path: '/capabilities',
    handler: capabilitiesHandler,
    cache: { ttl: 300000 }
  },
  
  // SSE连接
  {
    method: 'GET',
    path: '/mcp/sse',
    handler: sseConnectionHandler,
    middleware: [connectionLimitMiddleware, securityMiddleware]
  },
  
  // MCP消息处理
  {
    method: 'POST',
    path: '/mcp/message',
    handler: mcpMessageHandler,
    middleware: [rateLimitMiddleware, validationMiddleware],
    rateLimit: { limit: 1000, window: 3600000 }
  }
];
```

#### 中间件规格
```typescript
interface Middleware {
  (c: Context, next: () => Promise<void>): Promise<void>;
}

// CORS中间件
const corsMiddleware: Middleware = async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control, X-Connection-Id');
  c.header('Access-Control-Max-Age', '86400');
  
  if (c.req.method === 'OPTIONS') {
    return c.text('', 204);
  }
  
  await next();
};

// 安全头中间件
const securityMiddleware: Middleware = async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'none'");
  
  await next();
};

// 速率限制中间件
const rateLimitMiddleware: Middleware = async (c, next) => {
  const clientIP = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const key = `rate_limit:${clientIP}:${c.req.path}`;
  
  const current = await getRateLimitCount(key);
  if (current > RATE_LIMIT_THRESHOLD) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }
  
  await incrementRateLimitCount(key);
  await next();
};
```

### 4. 缓存系统技术规格

#### 缓存接口定义
```typescript
interface CacheEntry<T> {
  key: string;
  value: T;
  ttl: number;
  createdAt: number;
  lastAccessed: number;
  metadata?: CacheMetadata;
}

interface CacheMetadata {
  size: number;
  tags: string[];
  dependencies: string[];
}

abstract class Cache<T> {
  abstract get(key: string): Promise<T | null>;
  abstract set(key: string, value: T, ttl?: number): Promise<void>;
  abstract delete(key: string): Promise<boolean>;
  abstract clear(): Promise<void>;
  abstract keys(pattern?: string): Promise<string[]>;
  abstract size(): Promise<number>;
  abstract stats(): Promise<CacheStats>;
}
```

#### 多层缓存实现
```typescript
class MultiLevelCache<T> implements Cache<T> {
  private l1Cache: MemoryCache<T>;     // Worker内存缓存
  private l2Cache: KVCache<T>;         // Workers KV缓存
  
  constructor(
    private l1Config: MemoryCacheConfig,
    private l2Config: KVCacheConfig
  ) {
    this.l1Cache = new MemoryCache(l1Config);
    this.l2Cache = new KVCache(l2Config);
  }
  
  async get(key: string): Promise<T | null> {
    // L1缓存查找
    let value = await this.l1Cache.get(key);
    if (value !== null) {
      return value;
    }
    
    // L2缓存查找
    value = await this.l2Cache.get(key);
    if (value !== null) {
      // 回填L1缓存
      await this.l1Cache.set(key, value);
      return value;
    }
    
    return null;
  }
  
  async set(key: string, value: T, ttl?: number): Promise<void> {
    // 同时写入L1和L2缓存
    await Promise.all([
      this.l1Cache.set(key, value, ttl),
      this.l2Cache.set(key, value, ttl)
    ]);
  }
}
```

#### 缓存键规范
```typescript
interface CacheKeyGenerator {
  documentContent(url: string, partition: string): string;
  searchResults(query: string, limit: number, partition: string): string;
  serviceList(partition: string): string;
  recommendations(url: string, partition: string): string;
}

const cacheKeys: CacheKeyGenerator = {
  documentContent: (url, partition) => 
    `doc:${partition}:${btoa(url).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' })[m])}`,
  
  searchResults: (query, limit, partition) =>
    `search:${partition}:${limit}:${btoa(query).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' })[m])}`,
    
  serviceList: (partition) =>
    `services:${partition}`,
    
  recommendations: (url, partition) =>
    `rec:${partition}:${btoa(url).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' })[m])}`
};
```

## 🔒 安全技术规格

### 输入验证规格
```typescript
interface ValidationRule {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: RegExp;
  enum?: any[];
  custom?: (value: any) => boolean | string;
}

interface ValidationSchema {
  [key: string]: ValidationRule;
}

class InputValidator {
  private schemas: Map<string, ValidationSchema> = new Map();
  
  registerSchema(name: string, schema: ValidationSchema): void;
  validate(data: any, schemaName: string): ValidationResult;
  
  private validateField(value: any, rule: ValidationRule, fieldName: string): ValidationError[];
  private sanitizeString(value: string): string;
  private validateURL(url: string): boolean;
}

// URL验证规则
const AWS_DOCS_URL_PATTERN = /^https:\/\/docs\.aws(?:amazon|services)?\.(?:com|cn)\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;

// 输入清理规则
const SANITIZATION_RULES = {
  html: (input: string) => input.replace(/<[^>]*>/g, ''),
  sql: (input: string) => input.replace(/['";\\]/g, ''),
  script: (input: string) => input.replace(/<script[^>]*>.*?<\/script>/gi, ''),
  url: (input: string) => encodeURIComponent(input)
};
```

### 速率限制技术规格
```typescript
interface RateLimitRule {
  window: number;           // 时间窗口 (毫秒)
  limit: number;           // 请求限制
  burst?: number;          // 突发限制
  skipSuccessfulRequests?: boolean;  // 跳过成功请求
  skipFailedRequests?: boolean;      // 跳过失败请求
  keyGenerator?: (req: Request) => string;  // 键生成器
}

interface RateLimitConfig {
  global: RateLimitRule;
  perIP: RateLimitRule;
  perEndpoint: Map<string, RateLimitRule>;
  whitelist: string[];     // IP白名单
  blacklist: string[];     // IP黑名单
}

class RateLimiter {
  constructor(private config: RateLimitConfig) {}
  
  async checkLimit(request: Request, endpoint: string): Promise<RateLimitResult> {
    const clientIP = this.getClientIP(request);
    
    // 检查黑名单
    if (this.config.blacklist.includes(clientIP)) {
      return { allowed: false, reason: 'Blacklisted IP' };
    }
    
    // 检查白名单
    if (this.config.whitelist.includes(clientIP)) {
      return { allowed: true, reason: 'Whitelisted IP' };
    }
    
    // 检查各级限制
    const checks = [
      this.checkGlobalLimit(request),
      this.checkIPLimit(request, clientIP),
      this.checkEndpointLimit(request, endpoint)
    ];
    
    const results = await Promise.all(checks);
    const failed = results.find(r => !r.allowed);
    
    return failed || { allowed: true };
  }
}
```

## 📊 监控和可观测性技术规格

### 指标收集规格
```typescript
interface MetricDefinition {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  description: string;
  labels?: string[];
  unit?: string;
}

const METRICS_DEFINITIONS: MetricDefinition[] = [
  {
    name: 'http_requests_total',
    type: 'counter',
    description: 'Total number of HTTP requests',
    labels: ['method', 'endpoint', 'status_code', 'partition']
  },
  {
    name: 'http_request_duration_seconds',
    type: 'histogram',
    description: 'HTTP request duration in seconds',
    labels: ['method', 'endpoint', 'partition'],
    unit: 'seconds'
  },
  {
    name: 'sse_connections_active',
    type: 'gauge',
    description: 'Number of active SSE connections',
    labels: ['partition']
  },
  {
    name: 'cache_hit_ratio',
    type: 'gauge',
    description: 'Cache hit ratio',
    labels: ['cache_level', 'cache_type']
  }
];

interface MetricsCollector {
  counter(name: string, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
  histogram(name: string, value: number, labels?: Record<string, string>): void;
  summary(name: string, value: number, labels?: Record<string, string>): void;
}
```

### 日志规格
```typescript
enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

interface LogEntry {
  timestamp: string;        // ISO 8601格式
  level: LogLevel;
  message: string;
  component: string;
  requestId?: string;
  userId?: string;
  partition?: 'aws' | 'aws-cn';
  metadata?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

class Logger {
  constructor(private component: string, private minLevel: LogLevel = LogLevel.INFO) {}
  
  error(message: string, error?: Error, metadata?: Record<string, any>): void;
  warn(message: string, metadata?: Record<string, any>): void;
  info(message: string, metadata?: Record<string, any>): void;
  debug(message: string, metadata?: Record<string, any>): void;
  
  private createLogEntry(level: LogLevel, message: string, metadata?: Record<string, any>, error?: Error): LogEntry;
  private shouldLog(level: LogLevel): boolean;
  private formatLogEntry(entry: LogEntry): string;
}

// 结构化日志格式
const LOG_FORMAT = {
  timestamp: 'YYYY-MM-DDTHH:mm:ss.sssZ',
  level: 'ERROR|WARN|INFO|DEBUG',
  component: 'string',
  message: 'string',
  requestId: 'uuid?',
  metadata: 'object?',
  error: {
    name: 'string',
    message: 'string',
    stack: 'string?'
  }
};
```

### 健康检查技术规格
```typescript
interface HealthCheck {
  name: string;
  timeout: number;
  critical: boolean;
  check(): Promise<HealthCheckResult>;
}

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  details?: Record<string, any>;
  timestamp: string;
  duration: number;
}

interface SystemHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  checks: Record<string, HealthCheckResult>;
  metrics: {
    memory: MemoryInfo;
    connections: ConnectionInfo;
    cache: CacheInfo;
  };
}

class HealthChecker {
  private checks: Map<string, HealthCheck> = new Map();
  
  registerCheck(name: string, check: HealthCheck): void;
  async runChecks(): Promise<SystemHealth>;
  async runCheck(name: string): Promise<HealthCheckResult>;
  
  // 内置健康检查
  private awsAPICheck: HealthCheck = {
    name: 'aws-api',
    timeout: 5000,
    critical: true,
    check: async () => {
      try {
        const response = await fetch('https://docs.aws.amazon.com', {
          method: 'HEAD',
          timeout: 5000
        });
        return {
          status: response.ok ? 'healthy' : 'unhealthy',
          details: { statusCode: response.status }
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          message: error.message
        };
      }
    }
  };
}
```

## 🔄 部署和配置技术规格

### 环境配置规格
```typescript
interface EnvironmentConfig {
  // 基础配置
  NODE_ENV: 'development' | 'staging' | 'production';
  AWS_DOCUMENTATION_PARTITION: 'aws' | 'aws-cn';
  FASTMCP_LOG_LEVEL: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  
  // Workers配置
  WORKER_CPU_LIMIT: number;        // 默认: 10ms
  WORKER_MEMORY_LIMIT: number;     // 默认: 128MB
  WORKER_TIMEOUT: number;          // 默认: 30000ms
  
  // 缓存配置
  CACHE_TTL_DOCUMENTS: number;     // 默认: 3600000ms (1小时)
  CACHE_TTL_SEARCH: number;        // 默认: 1800000ms (30分钟)
  CACHE_TTL_SERVICES: number;      // 默认: 86400000ms (24小时)
  
  // 速率限制配置
  RATE_LIMIT_GLOBAL: number;       // 默认: 100000/小时
  RATE_LIMIT_PER_IP: number;       // 默认: 1000/小时
  RATE_LIMIT_BURST: number;        // 默认: 2000
  
  // 监控配置
  ANALYTICS_TOKEN?: string;
  MONITORING_ENDPOINT?: string;
  ALERT_WEBHOOK_URL?: string;
}

// 环境变量验证
class ConfigValidator {
  static validate(config: Record<string, string>): EnvironmentConfig {
    const validated: Partial<EnvironmentConfig> = {};
    
    // 必需字段验证
    if (!['development', 'staging', 'production'].includes(config.NODE_ENV)) {
      throw new Error('Invalid NODE_ENV');
    }
    validated.NODE_ENV = config.NODE_ENV as any;
    
    // 可选字段验证和默认值
    validated.AWS_DOCUMENTATION_PARTITION = config.AWS_DOCUMENTATION_PARTITION as any || 'aws';
    validated.FASTMCP_LOG_LEVEL = config.FASTMCP_LOG_LEVEL as any || 'INFO';
    
    // 数值字段验证
    validated.WORKER_CPU_LIMIT = parseInt(config.WORKER_CPU_LIMIT) || 10;
    validated.WORKER_MEMORY_LIMIT = parseInt(config.WORKER_MEMORY_LIMIT) || 134217728; // 128MB
    
    return validated as EnvironmentConfig;
  }
}
```

### Wrangler配置规格
```toml
# wrangler.toml
name = "aws-docs-mcp-server"
main = "dist/index.js"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat", "streams_enable_constructors"]
minify = true
send_metrics = true

[build]
command = "npm run build"

# 开发环境
[env.development]
name = "aws-docs-mcp-server-dev"
vars = { NODE_ENV = "development", AWS_DOCUMENTATION_PARTITION = "aws", FASTMCP_LOG_LEVEL = "DEBUG" }

# 测试环境
[env.staging]
name = "aws-docs-mcp-server-staging"
vars = { NODE_ENV = "staging", AWS_DOCUMENTATION_PARTITION = "aws", FASTMCP_LOG_LEVEL = "INFO" }
route = "staging.aws-mcp.workers.dev/*"

# 生产环境
[env.production]
name = "aws-docs-mcp-server-prod" 
vars = { NODE_ENV = "production", AWS_DOCUMENTATION_PARTITION = "aws", FASTMCP_LOG_LEVEL = "ERROR" }
route = "aws-mcp.your-domain.com/*"
usage_model = "bundled"

# Workers KV绑定
[[kv_namespaces]]
binding = "CACHE"
id = "your-kv-namespace-id"
preview_id = "your-preview-kv-namespace-id"

# Durable Objects绑定 (如需要)
[[durable_objects.bindings]]
name = "CONNECTION_MANAGER"
class_name = "ConnectionManager"
```

## 📈 性能优化技术规格

### 代码分割和打包优化
```typescript
// 动态导入配置
interface CodeSplitConfig {
  // 工具特定分割
  toolHandlers: {
    readDocs: () => import('./handlers/read-docs');
    searchDocs: () => import('./handlers/search-docs');
    recommend: () => import('./handlers/recommend');
    services: () => import('./handlers/services');
  };
  
  // 分区特定分割
  partitions: {
    aws: () => import('./partitions/aws');
    awsCn: () => import('./partitions/aws-cn');
  };
  
  // 工具库分割
  utilities: {
    htmlParser: () => import('./utils/html-parser');
    markdown: () => import('./utils/markdown');
    cache: () => import('./utils/cache');
  };
}

// Bundle大小目标
const BUNDLE_SIZE_TARGETS = {
  main: 50 * 1024,        // 50KB主包
  handlers: 10 * 1024,    // 10KB每个处理器
  utilities: 15 * 1024,   // 15KB工具库
  total: 100 * 1024       // 100KB总大小
};
```

### 内存优化规格
```typescript
interface MemoryManagement {
  // 内存池配置
  pools: {
    strings: MemoryPool<string>;
    objects: MemoryPool<object>;
    buffers: MemoryPool<ArrayBuffer>;
  };
  
  // 垃圾回收提示
  gcHints: {
    afterRequest: boolean;      // 请求后GC
    afterBatch: boolean;        // 批处理后GC
    lowMemory: boolean;         // 低内存时GC
  };
  
  // 内存监控
  monitoring: {
    enabled: boolean;
    threshold: number;          // 内存使用阈值
    alertCallback: (usage: number) => void;
  };
}

class MemoryManager {
  private static instance: MemoryManager;
  private pools: Map<string, any[]> = new Map();
  
  static getInstance(): MemoryManager {
    if (!this.instance) {
      this.instance = new MemoryManager();
    }
    return this.instance;
  }
  
  getFromPool<T>(poolName: string, factory: () => T): T;
  returnToPool<T>(poolName: string, item: T): void;
  clearPool(poolName: string): void;
  getMemoryUsage(): MemoryUsage;
  forceGC(): void;
}
```

## 🧪 测试技术规格

### 单元测试规格
```typescript
interface TestConfig {
  testTimeout: number;           // 默认: 5000ms
  setupTimeout: number;          // 默认: 10000ms
  coverageThreshold: {
    global: {
      branches: number;          // 默认: 90%
      functions: number;         // 默认: 90%
      lines: number;            // 默认: 90%
      statements: number;        // 默认: 90%
    };
  };
  testEnvironment: 'miniflare' | 'node';
  setupFilesAfterEnv: string[];
}

// Jest配置
export default {
  preset: 'ts-jest',
  testEnvironment: 'miniflare',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts'
  ],
  coverageReporters: ['text', 'lcov', 'html'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest'
  }
} as Config;
```

### 集成测试规格
```typescript
interface IntegrationTestSuite {
  // SSE连接测试
  sseConnectionTests: {
    basicConnection: () => Promise<void>;
    connectionRecovery: () => Promise<void>;
    multipleConnections: () => Promise<void>;
    connectionCleanup: () => Promise<void>;
  };
  
  // MCP协议测试
  mcpProtocolTests: {
    initializeSequence: () => Promise<void>;
    toolsListCall: () => Promise<void>;
    toolsCallExecution: () => Promise<void>;
    errorHandling: () => Promise<void>;
  };
  
  // AWS API集成测试
  awsIntegrationTests: {
    documentRetrieval: () => Promise<void>;
    searchFunctionality: () => Promise<void>;
    recommendationEngine: () => Promise<void>;
    serviceListQuery: () => Promise<void>;
  };
}

// 测试工具类
class TestClient {
  private baseUrl: string;
  private eventSource?: EventSource;
  
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }
  
  async connectSSE(): Promise<EventSource>;
  async sendMessage(message: MCPMessage): Promise<MCPMessage>;
  async disconnect(): Promise<void>;
  
  // 测试辅助方法
  async waitForMessage(timeout: number = 5000): Promise<MessageEvent>;
  async expectMessage(predicate: (msg: any) => boolean): Promise<any>;
  generateTestMessage(method: string, params?: any): MCPMessage;
}
```

---

**📋 技术规格说明书完成时间**: D8 (1天)
**审批负责人**: 技术架构师 + 开发团队Lead
**下一步**: MCP协议适配架构设计