import { MCPMessage, SSEMessage } from '../src/types';

export interface MCPClientOptions {
  baseUrl: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  timeout?: number;
  debug?: boolean;
}

export class SSEMCPClient {
  private baseUrl: string;
  private eventSource?: EventSource;
  private connectionId?: string;
  private connected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectInterval: number;
  private readonly timeout: number;
  private readonly debug: boolean;
  private pendingRequests = new Map<string | number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(options: MCPClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.timeout = options.timeout || 30000;
    this.debug = options.debug || false;
  }

  // Connect to the server
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.log('Connecting to SSE endpoint...');
        
        this.eventSource = new EventSource(`${this.baseUrl}/mcp/sse`);
        
        this.eventSource.onopen = () => {
          this.log('SSE connection established');
          this.connected = true;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.eventSource.onmessage = (event) => {
          this.handleSSEMessage(event.data);
        };

        this.eventSource.onerror = (error) => {
          this.log('SSE connection error:', error);
          this.connected = false;
          
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnect();
          } else {
            reject(new Error('Max reconnection attempts reached'));
          }
        };

        // Connection timeout
        setTimeout(() => {
          if (!this.connected) {
            reject(new Error('Connection timeout'));
          }
        }, this.timeout);

      } catch (error) {
        reject(error);
      }
    });
  }

  // Disconnect from server
  disconnect(): void {
    this.log('Disconnecting...');
    
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
    
    this.connected = false;
    this.connectionId = undefined;
    
    // Reject all pending requests
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }

  // Check if connected
  isConnected(): boolean {
    return this.connected && this.eventSource?.readyState === EventSource.OPEN;
  }

  // Get connection ID
  getConnectionId(): string | undefined {
    return this.connectionId;
  }

  // Send MCP message
  async sendMessage(message: MCPMessage): Promise<any> {
    if (!this.connected) {
      throw new Error('Not connected to server');
    }

    return new Promise((resolve, reject) => {
      const messageId = message.id || this.generateMessageId();
      message.id = messageId;

      // Set up timeout for this request
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error(`Request timeout for message ${messageId}`));
      }, this.timeout);

      // Store pending request
      this.pendingRequests.set(messageId, {
        resolve,
        reject,
        timeout: timeoutId
      });

      // Send message via POST
      fetch(`${this.baseUrl}/mcp/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Connection-Id': this.connectionId || ''
        },
        body: JSON.stringify(message)
      })
      .then(response => response.json())
      .then(responseMessage => {
        const pending = this.pendingRequests.get(messageId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(messageId);
          
          if (responseMessage.error) {
            pending.reject(new Error(responseMessage.error.message));
          } else {
            pending.resolve(responseMessage.result);
          }
        }
      })
      .catch(error => {
        const pending = this.pendingRequests.get(messageId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(messageId);
          pending.reject(error);
        }
      });
    });
  }

  // Initialize MCP session
  async initialize(clientInfo?: any): Promise<any> {
    const message: MCPMessage = {
      jsonrpc: '2.0',
      id: this.generateMessageId(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          experimental: {
            sse: true
          }
        },
        clientInfo: clientInfo || {
          name: 'SSE-MCP-Client',
          version: '1.0.0'
        }
      }
    };

    const result = await this.sendMessage(message);
    
    // Send initialized notification
    await this.sendMessage({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });

    return result;
  }

  // List available tools
  async listTools(): Promise<any> {
    return this.sendMessage({
      jsonrpc: '2.0',
      id: this.generateMessageId(),
      method: 'tools/list'
    });
  }

  // Call a tool
  async callTool(name: string, arguments: any): Promise<any> {
    return this.sendMessage({
      jsonrpc: '2.0',
      id: this.generateMessageId(),
      method: 'tools/call',
      params: {
        name,
        arguments
      }
    });
  }

  // AWS Documentation specific methods

  // Read AWS documentation
  async readDocumentation(url: string): Promise<string> {
    const result = await this.callTool('read_documentation', { url });
    return result.content?.[0]?.text || '';
  }

  // Search AWS documentation
  async searchDocumentation(search_phrase: string, limit = 10): Promise<string> {
    const result = await this.callTool('search_documentation', { search_phrase, limit });
    return result.content?.[0]?.text || '';
  }

  // Get recommendations
  async getRecommendations(url: string): Promise<string> {
    const result = await this.callTool('recommend', { url });
    return result.content?.[0]?.text || '';
  }

  // Get available services (China partition only)
  async getAvailableServices(): Promise<string> {
    const result = await this.callTool('get_available_services', {});
    return result.content?.[0]?.text || '';
  }

  // Private methods

  private handleSSEMessage(data: string): void {
    try {
      const message: SSEMessage = JSON.parse(data);
      this.log('Received SSE message:', message);

      switch (message.type) {
        case 'init':
          this.connectionId = message.id;
          this.log('Connection initialized with ID:', this.connectionId);
          break;

        case 'ping':
          this.handlePing(message);
          break;

        case 'response':
          this.handleResponse(message);
          break;

        case 'error':
          this.handleError(message);
          break;

        default:
          this.log('Unknown message type:', message.type);
      }
    } catch (error) {
      this.log('Error parsing SSE message:', error);
    }
  }

  private handlePing(message: SSEMessage): void {
    // Respond with pong
    fetch(`${this.baseUrl}/mcp/pong`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Connection-Id': this.connectionId || ''
      }
    }).catch(error => {
      this.log('Error sending pong:', error);
    });
  }

  private handleResponse(message: SSEMessage): void {
    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.id);
      pending.resolve(message.data);
    }
  }

  private handleError(message: SSEMessage): void {
    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.id);
      pending.reject(new Error(message.data.message || 'Unknown error'));
    }
  }

  private reconnect(): void {
    this.reconnectAttempts++;
    this.log(`Reconnecting... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(error => {
        this.log('Reconnection failed:', error);
      });
    }, this.reconnectInterval);
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private log(message: string, ...args: any[]): void {
    if (this.debug) {
      console.log(`[SSE-MCP-Client] ${message}`, ...args);
    }
  }
}

export default SSEMCPClient;