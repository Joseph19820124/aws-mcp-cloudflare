import { AWSDocsHandler } from '../../src/aws-docs-handler';
import { MCPMessage, Env } from '../../src/types';

describe('AWSDocsHandler', () => {
  let handler: AWSDocsHandler;
  let mockEnv: Env;

  beforeEach(() => {
    mockEnv = {
      AWS_DOCUMENTATION_PARTITION: 'aws',
      FASTMCP_LOG_LEVEL: 'ERROR'
    };
    handler = new AWSDocsHandler(mockEnv);
  });

  describe('Tool Configuration', () => {
    test('should provide tools for global partition', () => {
      const tools = handler.getAvailableTools();
      
      expect(tools).toHaveLength(3);
      expect(tools.map(t => t.name)).toContain('read_documentation');
      expect(tools.map(t => t.name)).toContain('search_documentation');
      expect(tools.map(t => t.name)).toContain('recommend');
    });

    test('should provide tools for China partition', () => {
      const chinaEnv = { ...mockEnv, AWS_DOCUMENTATION_PARTITION: 'aws-cn' };
      const chinaHandler = new AWSDocsHandler(chinaEnv);
      const tools = chinaHandler.getAvailableTools();
      
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toContain('read_documentation');
      expect(tools.map(t => t.name)).toContain('get_available_services');
      expect(tools.map(t => t.name)).not.toContain('search_documentation');
      expect(tools.map(t => t.name)).not.toContain('recommend');
    });
  });

  describe('Tools List Handler', () => {
    test('should handle tools/list request', async () => {
      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/list'
      };

      const response = await handler.handleToolsList(message);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test-123');
      expect(response.result.tools).toHaveLength(3);
      expect(response.error).toBeUndefined();
    });
  });

  describe('Read Documentation Tool', () => {
    beforeEach(() => {
      // Mock successful fetch response
      const mockHtml = `
        <main>
          <h1>EC2 Concepts</h1>
          <p>Amazon EC2 provides scalable computing capacity.</p>
          <a href="/guide">User Guide</a>
          <pre><code>aws ec2 describe-instances</code></pre>
        </main>
      `;
      testUtils.mockFetch(mockHtml);
    });

    test('should handle read_documentation call', async () => {
      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/call',
        params: {
          name: 'read_documentation',
          arguments: {
            url: 'https://docs.aws.amazon.com/ec2/latest/userguide/concepts.html'
          }
        }
      };

      const response = await handler.handleToolsCall(message);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test-123');
      expect(response.result.content).toHaveLength(1);
      expect(response.result.content[0].type).toBe('text');
      expect(response.result.content[0].text).toContain('# EC2 Concepts');
      expect(response.result.content[0].text).toContain('Amazon EC2 provides scalable computing capacity');
      expect(response.error).toBeUndefined();
    });

    test('should reject invalid AWS documentation URL', async () => {
      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/call',
        params: {
          name: 'read_documentation',
          arguments: {
            url: 'https://malicious-site.com/fake-docs'
          }
        }
      };

      const response = await handler.handleToolsCall(message);

      expect(response.error).toBeDefined();
      expect(response.error?.message).toBe('Tool execution failed');
      expect(response.error?.data).toContain('Invalid AWS documentation URL');
    });

    test('should handle fetch errors', async () => {
      testUtils.mockFetch('Not Found', 404);

      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/call',
        params: {
          name: 'read_documentation',
          arguments: {
            url: 'https://docs.aws.amazon.com/ec2/latest/userguide/concepts.html'
          }
        }
      };

      const response = await handler.handleToolsCall(message);

      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain('Error reading documentation');
    });
  });

  describe('Search Documentation Tool', () => {
    beforeEach(() => {
      const mockSearchResults = {
        hits: {
          total: { value: 2 },
          hits: [
            {
              _source: {
                title: 'S3 Bucket Overview',
                url: 'https://docs.aws.amazon.com/s3/latest/userguide/buckets.html',
                summary: 'Learn about S3 buckets and their features',
                service: 's3'
              }
            },
            {
              _source: {
                title: 'S3 Bucket Policies',
                url: 'https://docs.aws.amazon.com/s3/latest/userguide/bucket-policies.html',
                summary: 'Configure bucket policies for access control',
                service: 's3'
              }
            }
          ]
        }
      };
      testUtils.mockFetch(mockSearchResults);
    });

    test('should handle search_documentation call', async () => {
      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/call',
        params: {
          name: 'search_documentation',
          arguments: {
            search_phrase: 'S3 bucket',
            limit: 5
          }
        }
      };

      const response = await handler.handleToolsCall(message);

      expect(response.result.content[0].text).toContain('Search Results for "S3 bucket"');
      expect(response.result.content[0].text).toContain('S3 Bucket Overview');
      expect(response.result.content[0].text).toContain('S3 Bucket Policies');
      expect(response.error).toBeUndefined();
    });

    test('should reject search for China partition', async () => {
      const chinaEnv = { ...mockEnv, AWS_DOCUMENTATION_PARTITION: 'aws-cn' };
      const chinaHandler = new AWSDocsHandler(chinaEnv);

      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/call',
        params: {
          name: 'search_documentation',
          arguments: {
            search_phrase: 'S3 bucket'
          }
        }
      };

      const response = await chinaHandler.handleToolsCall(message);

      expect(response.error).toBeDefined();
      expect(response.error?.data).toContain('Search documentation is only available for global AWS partition');
    });
  });

  describe('Recommend Tool', () => {
    test('should handle recommend call', async () => {
      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/call',
        params: {
          name: 'recommend',
          arguments: {
            url: 'https://docs.aws.amazon.com/lambda/latest/dg/welcome.html'
          }
        }
      };

      const response = await handler.handleToolsCall(message);

      expect(response.result.content[0].text).toContain('Content Recommendations');
      expect(response.result.content[0].text).toContain('lambda');
      expect(response.result.content[0].text).toContain('Getting Started Guide');
      expect(response.error).toBeUndefined();
    });

    test('should reject recommend for China partition', async () => {
      const chinaEnv = { ...mockEnv, AWS_DOCUMENTATION_PARTITION: 'aws-cn' };
      const chinaHandler = new AWSDocsHandler(chinaEnv);

      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/call',
        params: {
          name: 'recommend',
          arguments: {
            url: 'https://docs.aws.amazon.com/lambda/latest/dg/welcome.html'
          }
        }
      };

      const response = await chinaHandler.handleToolsCall(message);

      expect(response.error).toBeDefined();
      expect(response.error?.data).toContain('Recommendations are only available for global AWS partition');
    });
  });

  describe('Get Available Services Tool', () => {
    test('should handle get_available_services for China partition', async () => {
      const chinaEnv = { ...mockEnv, AWS_DOCUMENTATION_PARTITION: 'aws-cn' };
      const chinaHandler = new AWSDocsHandler(chinaEnv);

      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/call',
        params: {
          name: 'get_available_services',
          arguments: {}
        }
      };

      const response = await chinaHandler.handleToolsCall(message);

      expect(response.result.content[0].text).toContain('Available AWS Services in China');
      expect(response.result.content[0].text).toContain('EC2');
      expect(response.result.content[0].text).toContain('S3');
      expect(response.error).toBeUndefined();
    });

    test('should reject get_available_services for global partition', async () => {
      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/call',
        params: {
          name: 'get_available_services',
          arguments: {}
        }
      };

      const response = await handler.handleToolsCall(message);

      expect(response.error).toBeDefined();
      expect(response.error?.data).toContain('Service list is only available for China AWS partition');
    });
  });

  describe('Unknown Tool Handling', () => {
    test('should handle unknown tool calls', async () => {
      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/call',
        params: {
          name: 'unknown_tool',
          arguments: {}
        }
      };

      const response = await handler.handleToolsCall(message);

      expect(response.error).toBeDefined();
      expect(response.error?.message).toBe('Tool execution failed');
      expect(response.error?.data).toContain('Unknown tool: unknown_tool');
    });
  });

  describe('HTML to Markdown Conversion', () => {
    test('should convert basic HTML elements', async () => {
      const mockHtml = `
        <main>
          <h1>Main Title</h1>
          <h2>Subtitle</h2>
          <p>This is a paragraph with <strong>bold</strong> text.</p>
          <a href="/guide">Link to guide</a>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
          <pre><code>console.log('code');</code></pre>
        </main>
      `;
      testUtils.mockFetch(mockHtml);

      const message: MCPMessage = {
        jsonrpc: '2.0',
        id: 'test-123',
        method: 'tools/call',
        params: {
          name: 'read_documentation',
          arguments: {
            url: 'https://docs.aws.amazon.com/test.html'
          }
        }
      };

      const response = await handler.handleToolsCall(message);
      const content = response.result.content[0].text;

      expect(content).toContain('# Main Title');
      expect(content).toContain('## Subtitle');
      expect(content).toContain('This is a paragraph');
      expect(content).toContain('* Item 1');
      expect(content).toContain('* Item 2');
      expect(content).toContain('```\nconsole.log(\'code\');\n```');
    });
  });
});