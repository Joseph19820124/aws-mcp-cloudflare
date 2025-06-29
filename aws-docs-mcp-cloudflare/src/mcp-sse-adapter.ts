import { MCPMessage, SSEMessage, ConnectionState } from './types';

export class MCPSSEAdapter {
  private connections = new Map<string, ConnectionState>();
  private messageHandlers = new Map<string, (message: MCPMessage) => Promise<MCPMessage>>();

  // Generate unique connection ID
  generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Register connection
  registerConnection(id: string, partition: 'aws' | 'aws-cn' = 'aws'): void {
    this.connections.set(id, {
      id,
      connected: true,
      lastPing: Date.now(),
      partition
    });
  }

  // Unregister connection
  unregisterConnection(id: string): void {
    this.connections.delete(id);
  }

  // Get connection state
  getConnection(id: string): ConnectionState | undefined {
    return this.connections.get(id);
  }

  // Register message handler
  registerHandler(method: string, handler: (message: MCPMessage) => Promise<MCPMessage>): void {
    this.messageHandlers.set(method, handler);
  }

  // Process MCP message
  async processMessage(message: MCPMessage, connectionId?: string): Promise<MCPMessage> {
    try {
      // Validate message format
      if (!message.jsonrpc || message.jsonrpc !== '2.0') {
        return this.createErrorResponse(message.id, -32600, 'Invalid Request: missing or invalid jsonrpc field');
      }

      // Handle different message types
      if (message.method) {
        // This is a request
        const handler = this.messageHandlers.get(message.method);
        if (!handler) {
          return this.createErrorResponse(message.id, -32601, `Method not found: ${message.method}`);
        }

        return await handler(message);
      } else if (message.result !== undefined || message.error !== undefined) {
        // This is a response - typically not handled by server
        return this.createErrorResponse(message.id, -32600, 'Invalid Request: unexpected response message');
      } else {
        return this.createErrorResponse(message.id, -32600, 'Invalid Request: missing method');
      }
    } catch (error) {
      console.error('Error processing MCP message:', error);
      return this.createErrorResponse(
        message.id, 
        -32603, 
        'Internal error',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  // Create SSE message
  createSSEMessage(type: SSEMessage['type'], id: string, data: any): string {
    const message: SSEMessage = {
      type,
      id,
      data,
      timestamp: Date.now()
    };

    return `data: ${JSON.stringify(message)}\n\n`;
  }

  // Create init message for new connections
  createInitMessage(connectionId: string, capabilities: any): string {
    return this.createSSEMessage('init', connectionId, {
      capabilities,
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: 'aws-docs-mcp-server',
        version: '1.0.0',
        description: 'AWS Documentation MCP Server with SSE support'
      }
    });
  }

  // Create ping message
  createPingMessage(connectionId: string): string {
    return this.createSSEMessage('ping', connectionId, {});
  }

  // Create success response
  createSuccessResponse(id: string | number | undefined, result: any): MCPMessage {
    return {
      jsonrpc: '2.0',
      id,
      result
    };
  }

  // Create error response
  createErrorResponse(
    id: string | number | undefined, 
    code: number, 
    message: string, 
    data?: any
  ): MCPMessage {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data
      }
    };
  }

  // Cleanup inactive connections
  cleanupConnections(maxAge: number = 300000): void { // 5 minutes default
    const now = Date.now();
    for (const [id, conn] of this.connections.entries()) {
      if (now - conn.lastPing > maxAge) {
        this.connections.delete(id);
      }
    }
  }

  // Update connection ping
  updateConnectionPing(id: string): void {
    const conn = this.connections.get(id);
    if (conn) {
      conn.lastPing = Date.now();
    }
  }

  // Get all active connections
  getActiveConnections(): ConnectionState[] {
    return Array.from(this.connections.values());
  }

  // Handle pong response
  handlePong(connectionId: string): void {
    this.updateConnectionPing(connectionId);
  }

  // Validate SSE message format
  validateSSEMessage(data: any): data is SSEMessage {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.type === 'string' &&
      typeof data.id === 'string' &&
      typeof data.timestamp === 'number' &&
      ['init', 'request', 'response', 'error', 'ping', 'pong'].includes(data.type)
    );
  }
}