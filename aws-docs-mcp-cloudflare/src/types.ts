// MCP Protocol Types
export interface MCPMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: any;
}

// SSE Message Types
export interface SSEMessage {
  type: 'init' | 'request' | 'response' | 'error' | 'ping' | 'pong';
  id: string;
  data: any;
  timestamp: number;
}

// AWS Documentation Tool Types
export interface ReadDocumentationParams {
  url: string;
}

export interface SearchDocumentationParams {
  search_phrase: string;
  limit?: number;
}

export interface RecommendParams {
  url: string;
}

export interface GetAvailableServicesParams {
  // No parameters needed
}

// Tool Call Types
export interface ToolCall {
  name: string;
  arguments: any;
}

export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

// Server Capabilities
export interface ServerCapabilities {
  tools: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  experimental?: {
    [key: string]: any;
  };
}

// Connection State
export interface ConnectionState {
  id: string;
  connected: boolean;
  lastPing: number;
  partition: 'aws' | 'aws-cn';
}

// Environment Variables
export interface Env {
  AWS_DOCUMENTATION_PARTITION?: string;
  FASTMCP_LOG_LEVEL?: string;
}