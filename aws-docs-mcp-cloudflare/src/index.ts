import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { MCPSSEAdapter } from './mcp-sse-adapter';
import { AWSDocsHandler } from './aws-docs-handler';
import { MCPMessage, Env, ServerCapabilities } from './types';

// Create Hono app
const app = new Hono<{ Bindings: Env }>();

// Global instances
let mcpAdapter: MCPSSEAdapter;
let awsHandler: AWSDocsHandler;

// CORS configuration
app.use('/*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'Cache-Control'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  maxAge: 86400,
}));

// Initialize handlers
app.use('*', async (c, next) => {
  if (!mcpAdapter) {
    mcpAdapter = new MCPSSEAdapter();
    awsHandler = new AWSDocsHandler(c.env);

    // Register MCP message handlers
    mcpAdapter.registerHandler('tools/list', (message) => awsHandler.handleToolsList(message));
    mcpAdapter.registerHandler('tools/call', (message) => awsHandler.handleToolsCall(message));
    mcpAdapter.registerHandler('initialize', handleInitialize);
    mcpAdapter.registerHandler('notifications/initialized', handleInitialized);
  }
  await next();
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    partition: c.env.AWS_DOCUMENTATION_PARTITION || 'aws',
    version: '1.0.0'
  });
});

// Capabilities endpoint
app.get('/capabilities', (c) => {
  const capabilities: ServerCapabilities = {
    tools: {
      listChanged: false
    },
    experimental: {
      sse: true,
      partition: c.env.AWS_DOCUMENTATION_PARTITION || 'aws'
    }
  };

  return c.json({ capabilities });
});

// SSE connection endpoint
app.get('/mcp/sse', async (c) => {
  const connectionId = mcpAdapter.generateConnectionId();
  const partition = (c.env.AWS_DOCUMENTATION_PARTITION as 'aws' | 'aws-cn') || 'aws';
  
  // Register connection
  mcpAdapter.registerConnection(connectionId, partition);

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      
      // Send initial capabilities
      const capabilities: ServerCapabilities = {
        tools: {
          listChanged: false
        },
        experimental: {
          sse: true,
          partition
        }
      };

      const initMessage = mcpAdapter.createInitMessage(connectionId, capabilities);
      controller.enqueue(encoder.encode(initMessage));

      // Set up ping interval
      const pingInterval = setInterval(() => {
        try {
          const pingMessage = mcpAdapter.createPingMessage(connectionId);
          controller.enqueue(encoder.encode(pingMessage));
        } catch (error) {
          console.error('Error sending ping:', error);
          clearInterval(pingInterval);
          controller.close();
        }
      }, 30000); // Ping every 30 seconds

      // Cleanup on close
      c.req.raw.signal?.addEventListener('abort', () => {
        clearInterval(pingInterval);
        mcpAdapter.unregisterConnection(connectionId);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'X-Connection-Id': connectionId
    }
  });
});

// Message sending endpoint
app.post('/mcp/message', async (c) => {
  try {
    const message: MCPMessage = await c.req.json();
    const connectionId = c.req.header('X-Connection-Id') || 'default';

    // Process the message
    const response = await mcpAdapter.processMessage(message, connectionId);

    return c.json(response);
  } catch (error) {
    console.error('Error processing message:', error);
    return c.json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    }, 400);
  }
});

// Pong endpoint for connection keep-alive
app.post('/mcp/pong', async (c) => {
  const connectionId = c.req.header('X-Connection-Id');
  if (connectionId) {
    mcpAdapter.handlePong(connectionId);
    return c.json({ status: 'ok' });
  }
  return c.json({ error: 'Missing connection ID' }, 400);
});

// Connection status endpoint
app.get('/mcp/connections', (c) => {
  const connections = mcpAdapter.getActiveConnections();
  return c.json({ 
    count: connections.length,
    connections: connections.map(conn => ({
      id: conn.id,
      connected: conn.connected,
      lastPing: conn.lastPing,
      partition: conn.partition,
      age: Date.now() - conn.lastPing
    }))
  });
});

// Cleanup endpoint for debugging
app.post('/mcp/cleanup', (c) => {
  mcpAdapter.cleanupConnections();
  return c.json({ status: 'cleanup completed' });
});

// MCP Protocol Handlers

async function handleInitialize(message: MCPMessage): Promise<MCPMessage> {
  const clientInfo = message.params?.clientInfo || {};
  const capabilities = message.params?.capabilities || {};

  return mcpAdapter.createSuccessResponse(message.id, {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {
        listChanged: false
      },
      experimental: {
        sse: true
      }
    },
    serverInfo: {
      name: 'aws-docs-mcp-server',
      version: '1.0.0',
      description: 'AWS Documentation MCP Server with SSE support'
    }
  });
}

async function handleInitialized(message: MCPMessage): Promise<MCPMessage> {
  // Initialization complete notification
  return mcpAdapter.createSuccessResponse(message.id, {});
}

// Default export for Cloudflare Workers
export default app;

// Named export for development
export { app };