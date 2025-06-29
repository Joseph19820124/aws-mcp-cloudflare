import SSEMCPClient from '../../client/sse-mcp-client';

describe('SSEMCPClient Integration', () => {
  let client: SSEMCPClient;
  const TEST_BASE_URL = 'http://localhost:8787';

  beforeEach(() => {
    client = new SSEMCPClient({
      baseUrl: TEST_BASE_URL,
      debug: false,
      timeout: 10000,
      maxReconnectAttempts: 3
    });
  });

  afterEach(() => {
    client.disconnect();
  });

  describe('Connection Management', () => {
    test('should establish SSE connection', async () => {
      // Mock EventSource for testing
      const mockEventSource = {
        readyState: 1,
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      };

      // Mock the onopen event
      (global.EventSource as jest.Mock).mockImplementation(() => {
        setTimeout(() => {
          mockEventSource.addEventListener.mock.calls
            .filter(call => call[0] === 'open')
            .forEach(call => call[1]());
        }, 100);
        return mockEventSource;
      });

      await expect(client.connect()).resolves.toBeUndefined();
      expect(client.isConnected()).toBe(true);
    });

    test('should handle connection timeout', async () => {
      const shortTimeoutClient = new SSEMCPClient({
        baseUrl: TEST_BASE_URL,
        timeout: 100
      });

      // Mock EventSource that never opens
      (global.EventSource as jest.Mock).mockImplementation(() => ({
        readyState: 0,
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      }));

      await expect(shortTimeoutClient.connect()).rejects.toThrow('Connection timeout');
    });

    test('should handle connection errors with retry', async () => {
      let attemptCount = 0;
      const mockEventSource = {
        readyState: 0,
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      };

      (global.EventSource as jest.Mock).mockImplementation(() => {
        attemptCount++;
        setTimeout(() => {
          const errorHandler = mockEventSource.addEventListener.mock.calls
            .find(call => call[0] === 'error')?.[1];
          if (errorHandler) errorHandler(new Error('Connection failed'));
        }, 50);
        return mockEventSource;
      });

      const retryClient = new SSEMCPClient({
        baseUrl: TEST_BASE_URL,
        maxReconnectAttempts: 2,
        reconnectInterval: 100
      });

      await expect(retryClient.connect()).rejects.toThrow('Max reconnection attempts reached');
      expect(attemptCount).toBeGreaterThan(1);
    });
  });

  describe('Message Handling', () => {
    beforeEach(async () => {
      // Mock successful connection
      const mockEventSource = {
        readyState: 1,
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      };

      (global.EventSource as jest.Mock).mockImplementation(() => {
        setTimeout(() => {
          // Trigger onopen
          mockEventSource.addEventListener.mock.calls
            .filter(call => call[0] === 'open')
            .forEach(call => call[1]());

          // Send init message
          const messageHandler = mockEventSource.addEventListener.mock.calls
            .find(call => call[0] === 'message')?.[1];
          if (messageHandler) {
            messageHandler({
              data: JSON.stringify({
                type: 'init',
                id: 'conn_123',
                data: {
                  capabilities: { tools: {} },
                  protocolVersion: '2024-11-05'
                },
                timestamp: Date.now()
              })
            });
          }
        }, 10);
        return mockEventSource;
      });

      await client.connect();
    });

    test('should send and receive MCP messages', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'test-123',
        result: { tools: [] }
      };

      testUtils.mockFetch(mockResponse);

      const result = await client.sendMessage({
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/list'
      });

      expect(result.tools).toBeDefined();
      expect(global.fetch).toHaveBeenCalledWith(
        `${TEST_BASE_URL}/mcp/message`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });

    test('should handle server errors', async () => {
      const mockErrorResponse = {
        jsonrpc: '2.0',
        id: 'test-123',
        error: {
          code: -32601,
          message: 'Method not found'
        }
      };

      testUtils.mockFetch(mockErrorResponse);

      await expect(client.sendMessage({
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'unknown/method'
      })).rejects.toThrow('Method not found');
    });

    test('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(client.sendMessage({
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/list'
      })).rejects.toThrow('Network error');
    });
  });

  describe('AWS Documentation Methods', () => {
    beforeEach(async () => {
      // Setup connection mock
      const mockEventSource = {
        readyState: 1,
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      };

      (global.EventSource as jest.Mock).mockImplementation(() => {
        setTimeout(() => {
          mockEventSource.addEventListener.mock.calls
            .filter(call => call[0] === 'open')
            .forEach(call => call[1]());
        }, 10);
        return mockEventSource;
      });

      await client.connect();
    });

    test('should read AWS documentation', async () => {
      const mockResult = {
        content: [{
          type: 'text',
          text: '# AWS EC2 Documentation\n\nThis is the EC2 documentation...'
        }]
      };

      testUtils.mockFetch({
        jsonrpc: '2.0',
        id: expect.any(String),
        result: mockResult
      });

      const result = await client.readDocumentation(
        'https://docs.aws.amazon.com/ec2/latest/userguide/concepts.html'
      );

      expect(result).toContain('# AWS EC2 Documentation');
      expect(result).toContain('This is the EC2 documentation');
    });

    test('should search AWS documentation', async () => {
      const mockResult = {
        content: [{
          type: 'text',
          text: '# Search Results for "S3 bucket"\n\nFound 5 results:\n\n## 1. S3 Overview...'
        }]
      };

      testUtils.mockFetch({
        jsonrpc: '2.0',
        id: expect.any(String),
        result: mockResult
      });

      const result = await client.searchDocumentation('S3 bucket', 5);

      expect(result).toContain('Search Results for "S3 bucket"');
      expect(result).toContain('Found 5 results');
    });

    test('should get recommendations', async () => {
      const mockResult = {
        content: [{
          type: 'text',
          text: '# Content Recommendations\n\nBased on Lambda documentation:\n\n1. Getting Started...'
        }]
      };

      testUtils.mockFetch({
        jsonrpc: '2.0',
        id: expect.any(String),
        result: mockResult
      });

      const result = await client.getRecommendations(
        'https://docs.aws.amazon.com/lambda/latest/dg/welcome.html'
      );

      expect(result).toContain('Content Recommendations');
      expect(result).toContain('Lambda documentation');
    });

    test('should get available services', async () => {
      const mockResult = {
        content: [{
          type: 'text',
          text: '# Available AWS Services in China\n\n1. EC2 - Elastic Compute Cloud\n2. S3 - Simple Storage Service'
        }]
      };

      testUtils.mockFetch({
        jsonrpc: '2.0',
        id: expect.any(String),
        result: mockResult
      });

      const result = await client.getAvailableServices();

      expect(result).toContain('Available AWS Services in China');
      expect(result).toContain('EC2 - Elastic Compute Cloud');
    });
  });

  describe('Ping/Pong Mechanism', () => {
    test('should handle ping messages and respond with pong', async () => {
      const mockEventSource = {
        readyState: 1,
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      };

      (global.EventSource as jest.Mock).mockImplementation(() => {
        setTimeout(() => {
          // Trigger connection
          mockEventSource.addEventListener.mock.calls
            .filter(call => call[0] === 'open')
            .forEach(call => call[1]());

          // Send ping message
          const messageHandler = mockEventSource.addEventListener.mock.calls
            .find(call => call[0] === 'message')?.[1];
          if (messageHandler) {
            messageHandler({
              data: JSON.stringify({
                type: 'ping',
                id: 'ping-123',
                data: {},
                timestamp: Date.now()
              })
            });
          }
        }, 10);
        return mockEventSource;
      });

      testUtils.mockFetch({ status: 'ok' });

      await client.connect();

      // Wait for ping to be processed
      await testUtils.delay(50);

      // Verify pong was sent
      expect(global.fetch).toHaveBeenCalledWith(
        `${TEST_BASE_URL}/mcp/pong`,
        expect.objectContaining({
          method: 'POST'
        })
      );
    });
  });

  describe('Concurrent Connections', () => {
    test('should handle multiple concurrent clients', async () => {
      const clients = Array.from({ length: 3 }, () => 
        new SSEMCPClient({
          baseUrl: TEST_BASE_URL,
          debug: false
        })
      );

      // Mock connections for all clients
      (global.EventSource as jest.Mock).mockImplementation(() => ({
        readyState: 1,
        close: jest.fn(),
        addEventListener: jest.fn((type, handler) => {
          if (type === 'open') {
            setTimeout(() => handler(), 10);
          }
        }),
        removeEventListener: jest.fn()
      }));

      // Connect all clients
      await Promise.all(clients.map(client => client.connect()));

      // Verify all are connected
      clients.forEach(client => {
        expect(client.isConnected()).toBe(true);
      });

      // Cleanup
      clients.forEach(client => client.disconnect());
    });
  });
});