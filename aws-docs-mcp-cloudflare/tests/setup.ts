// Jest test setup file
import { jest } from '@jest/globals';

// Global test configuration
jest.setTimeout(30000);

// Mock console methods for cleaner test output
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock fetch for testing
global.fetch = jest.fn();

// Mock EventSource for SSE testing
global.EventSource = jest.fn(() => ({
  close: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  readyState: 1,
  CONNECTING: 0,
  OPEN: 1,
  CLOSED: 2,
})) as any;

// Test environment variables
process.env.AWS_DOCUMENTATION_PARTITION = 'aws';
process.env.FASTMCP_LOG_LEVEL = 'ERROR';

// Global test utilities
global.testUtils = {
  createMockMCPMessage: (method: string, params?: any) => ({
    jsonrpc: '2.0' as const,
    id: Math.random().toString(36),
    method,
    params
  }),
  
  createMockSSEMessage: (type: string, data: any) => ({
    type,
    id: Math.random().toString(36),
    data,
    timestamp: Date.now()
  }),
  
  delay: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  
  mockFetch: (response: any, status = 200) => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => response,
      text: async () => typeof response === 'string' ? response : JSON.stringify(response)
    });
  }
};

// Cleanup after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Type declarations for global test utilities
declare global {
  var testUtils: {
    createMockMCPMessage: (method: string, params?: any) => any;
    createMockSSEMessage: (type: string, data: any) => any;
    delay: (ms: number) => Promise<void>;
    mockFetch: (response: any, status?: number) => void;
  };
}