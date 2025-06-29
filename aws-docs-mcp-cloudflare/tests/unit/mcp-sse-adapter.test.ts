import { MCPSSEAdapter } from '../../src/mcp-sse-adapter';
import { MCPMessage } from '../../src/types';

describe('MCPSSEAdapter', () => {
  let adapter: MCPSSEAdapter;

  beforeEach(() => {
    adapter = new MCPSSEAdapter();
  });

  describe('Connection Management', () => {
    test('should generate unique connection IDs', () => {
      const id1 = adapter.generateConnectionId();
      const id2 = adapter.generateConnectionId();
      
      expect(id1).toMatch(/^conn_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^conn_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    test('should register and retrieve connections', () => {
      const connectionId = 'test-conn-123';
      
      adapter.registerConnection(connectionId, 'aws');
      const connection = adapter.getConnection(connectionId);
      
      expect(connection).toBeDefined();
      expect(connection?.id).toBe(connectionId);
      expect(connection?.partition).toBe('aws');
      expect(connection?.connected).toBe(true);
    });

    test('should unregister connections', () => {
      const connectionId = 'test-conn-123';
      
      adapter.registerConnection(connectionId);
      expect(adapter.getConnection(connectionId)).toBeDefined();
      
      adapter.unregisterConnection(connectionId);
      expect(adapter.getConnection(connectionId)).toBeUndefined();
    });

    test('should update connection ping timestamp', () => {
      const connectionId = 'test-conn-123';
      adapter.registerConnection(connectionId);
      
      const initialPing = adapter.getConnection(connectionId)?.lastPing;
      
      // Wait a bit and update ping
      setTimeout(() => {
        adapter.updateConnectionPing(connectionId);
        const updatedPing = adapter.getConnection(connectionId)?.lastPing;
        expect(updatedPing).toBeGreaterThan(initialPing!);
      }, 10);
    });

    test('should cleanup inactive connections', () => {
      const activeId = 'active-conn';
      const inactiveId = 'inactive-conn';
      
      adapter.registerConnection(activeId);
      adapter.registerConnection(inactiveId);
      
      // Simulate old connection
      const inactiveConn = adapter.getConnection(inactiveId);
      if (inactiveConn) {
        inactiveConn.lastPing = Date.now() - 400000; // 400 seconds ago
      }
      
      adapter.cleanupConnections(300000); // 5 minutes max age
      
      expect(adapter.getConnection(activeId)).toBeDefined();
      expect(adapter.getConnection(inactiveId)).toBeUndefined();
    });
  });

  describe('Message Processing', () => {
    beforeEach(() => {
      // Register a mock handler
      adapter.registerHandler('test/method', async (message) => {
        return adapter.createSuccessResponse(message.id, { result: 'success' });
      });
    });

    test('should process valid MCP messages', async () => {
      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'test/method',
        params: { test: true }
      };

      const response = await adapter.processMessage(message);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test-123');
      expect(response.result).toEqual({ result: 'success' });
      expect(response.error).toBeUndefined();
    });

    test('should handle invalid jsonrpc version', async () => {
      const message = {
        jsonrpc: '1.0', // Invalid version
        id: 'test-123',
        method: 'test/method'
      } as MCPMessage;

      const response = await adapter.processMessage(message);

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32600);
      expect(response.error?.message).toContain('Invalid Request');
    });

    test('should handle method not found', async () => {
      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'unknown/method'
      };

      const response = await adapter.processMessage(message);

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32601);
      expect(response.error?.message).toContain('Method not found');
    });

    test('should handle handler exceptions', async () => {
      // Register a failing handler
      adapter.registerHandler('fail/method', async () => {
        throw new Error('Handler error');
      });

      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'fail/method'
      };

      const response = await adapter.processMessage(message);

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32603);
      expect(response.error?.message).toBe('Internal error');
    });
  });

  describe('SSE Message Creation', () => {
    test('should create valid SSE messages', () => {
      const message = adapter.createSSEMessage('response', 'test-123', { data: 'test' });
      
      expect(message).toMatch(/^data: /);
      expect(message).toMatch(/\n\n$/);
      
      const jsonData = message.substring(6, message.length - 2); // Remove "data: " and "\n\n"
      const parsed = JSON.parse(jsonData);
      
      expect(parsed.type).toBe('response');
      expect(parsed.id).toBe('test-123');
      expect(parsed.data).toEqual({ data: 'test' });
      expect(parsed.timestamp).toBeGreaterThan(0);
    });

    test('should create init message with capabilities', () => {
      const connectionId = 'test-conn';
      const capabilities = { tools: { listChanged: false } };
      
      const message = adapter.createInitMessage(connectionId, capabilities);
      const parsed = JSON.parse(message.substring(6, message.length - 2));
      
      expect(parsed.type).toBe('init');
      expect(parsed.id).toBe(connectionId);
      expect(parsed.data.capabilities).toEqual(capabilities);
      expect(parsed.data.protocolVersion).toBe('2024-11-05');
      expect(parsed.data.serverInfo).toBeDefined();
    });

    test('should create ping message', () => {
      const connectionId = 'test-conn';
      const message = adapter.createPingMessage(connectionId);
      const parsed = JSON.parse(message.substring(6, message.length - 2));
      
      expect(parsed.type).toBe('ping');
      expect(parsed.id).toBe(connectionId);
      expect(parsed.data).toEqual({});
    });
  });

  describe('Response Creation', () => {
    test('should create success response', () => {
      const response = adapter.createSuccessResponse('test-123', { result: 'data' });
      
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test-123');
      expect(response.result).toEqual({ result: 'data' });
      expect(response.error).toBeUndefined();
    });

    test('should create error response', () => {
      const response = adapter.createErrorResponse('test-123', -32600, 'Parse error', 'details');
      
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test-123');
      expect(response.result).toBeUndefined();
      expect(response.error).toEqual({
        code: -32600,
        message: 'Parse error',
        data: 'details'
      });
    });
  });

  describe('SSE Message Validation', () => {
    test('should validate correct SSE message', () => {
      const validMessage = {
        type: 'ping',
        id: 'test-123',
        data: {},
        timestamp: Date.now()
      };

      expect(adapter.validateSSEMessage(validMessage)).toBe(true);
    });

    test('should reject invalid SSE message', () => {
      const invalidMessages = [
        null,
        undefined,
        {},
        { type: 'ping' }, // missing required fields
        { type: 'invalid', id: 'test', timestamp: Date.now() }, // invalid type
        { type: 'ping', id: 123, timestamp: Date.now() } // wrong id type
      ];

      invalidMessages.forEach(message => {
        expect(adapter.validateSSEMessage(message)).toBe(false);
      });
    });
  });
});