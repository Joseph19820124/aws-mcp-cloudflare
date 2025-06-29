import { 
  MCPMessage, 
  ToolCall, 
  ToolResult, 
  ReadDocumentationParams,
  SearchDocumentationParams,
  RecommendParams,
  GetAvailableServicesParams,
  Env 
} from './types';

export class AWSDocsHandler {
  private partition: 'aws' | 'aws-cn';
  private logLevel: string;

  constructor(env: Env) {
    this.partition = (env.AWS_DOCUMENTATION_PARTITION as 'aws' | 'aws-cn') || 'aws';
    this.logLevel = env.FASTMCP_LOG_LEVEL || 'ERROR';
  }

  // Get available tools based on partition
  getAvailableTools() {
    const baseTools = [
      {
        name: 'read_documentation',
        description: 'Read and convert AWS documentation page to markdown format',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL of the AWS documentation page to read'
            }
          },
          required: ['url']
        }
      }
    ];

    if (this.partition === 'aws') {
      // Global partition supports search and recommend
      baseTools.push(
        {
          name: 'search_documentation',
          description: 'Search AWS documentation using the official search API',
          inputSchema: {
            type: 'object',
            properties: {
              search_phrase: {
                type: 'string',
                description: 'The search phrase to look for in AWS documentation'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (default: 10)',
                default: 10
              }
            },
            required: ['search_phrase']
          }
        },
        {
          name: 'recommend',
          description: 'Get content recommendations for a documentation page',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The URL of the documentation page to get recommendations for'
              }
            },
            required: ['url']
          }
        }
      );
    } else {
      // China partition supports service list
      baseTools.push({
        name: 'get_available_services',
        description: 'Get list of available AWS services in China region',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      });
    }

    return baseTools;
  }

  // Handle tools/list request
  async handleToolsList(message: MCPMessage): Promise<MCPMessage> {
    const tools = this.getAvailableTools();
    
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools
      }
    };
  }

  // Handle tools/call request
  async handleToolsCall(message: MCPMessage): Promise<MCPMessage> {
    try {
      const { name, arguments: args } = message.params as ToolCall;
      
      let result: ToolResult;

      switch (name) {
        case 'read_documentation':
          result = await this.readDocumentation(args as ReadDocumentationParams);
          break;
        case 'search_documentation':
          if (this.partition !== 'aws') {
            throw new Error('Search documentation is only available for global AWS partition');
          }
          result = await this.searchDocumentation(args as SearchDocumentationParams);
          break;
        case 'recommend':
          if (this.partition !== 'aws') {
            throw new Error('Recommendations are only available for global AWS partition');
          }
          result = await this.recommend(args as RecommendParams);
          break;
        case 'get_available_services':
          if (this.partition !== 'aws-cn') {
            throw new Error('Service list is only available for China AWS partition');
          }
          result = await this.getAvailableServices(args as GetAvailableServicesParams);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        jsonrpc: '2.0',
        id: message.id,
        result
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: 'Tool execution failed',
          data: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  // Read AWS documentation page
  private async readDocumentation(params: ReadDocumentationParams): Promise<ToolResult> {
    try {
      const { url } = params;

      // Validate URL
      if (!this.isValidAWSDocUrl(url)) {
        throw new Error('Invalid AWS documentation URL');
      }

      // Fetch the documentation page
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'AWS-MCP-Server/1.0.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch documentation: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const markdown = await this.convertHtmlToMarkdown(html, url);

      return {
        content: [
          {
            type: 'text',
            text: markdown
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error reading documentation: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  }

  // Search AWS documentation
  private async searchDocumentation(params: SearchDocumentationParams): Promise<ToolResult> {
    try {
      const { search_phrase, limit = 10 } = params;

      // Use AWS documentation search API
      const searchUrl = `https://docs.aws.amazon.com/search/search.json`;
      const searchParams = new URLSearchParams({
        q: search_phrase,
        size: limit.toString(),
        sort: '_score'
      });

      const response = await fetch(`${searchUrl}?${searchParams}`, {
        headers: {
          'User-Agent': 'AWS-MCP-Server/1.0.0',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status} ${response.statusText}`);
      }

      const searchResults = await response.json();
      
      // Format search results
      const formattedResults = this.formatSearchResults(searchResults, search_phrase);

      return {
        content: [
          {
            type: 'text',
            text: formattedResults
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error searching documentation: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  }

  // Get content recommendations
  private async recommend(params: RecommendParams): Promise<ToolResult> {
    try {
      const { url } = params;

      if (!this.isValidAWSDocUrl(url)) {
        throw new Error('Invalid AWS documentation URL');
      }

      // Extract service and topic from URL for recommendations
      const recommendations = await this.generateRecommendations(url);

      return {
        content: [
          {
            type: 'text',
            text: recommendations
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  }

  // Get available services (China partition only)
  private async getAvailableServices(params: GetAvailableServicesParams): Promise<ToolResult> {
    try {
      // Fetch China-specific service list
      const services = await this.fetchChinaServices();

      return {
        content: [
          {
            type: 'text',
            text: services
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting available services: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  }

  // Validate AWS documentation URL
  private isValidAWSDocUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      const validDomains = [
        'docs.aws.amazon.com',
        'docs.amazonaws.cn', // China partition
        'aws.amazon.com',
        'amazonaws.cn'
      ];
      
      return validDomains.some(domain => parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  }

  // Convert HTML to Markdown (simplified implementation)
  private async convertHtmlToMarkdown(html: string, sourceUrl: string): Promise<string> {
    // Extract main content from AWS docs HTML structure
    const contentMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) || 
                         html.match(/<div[^>]*class="[^"]*awsui-app-layout-main[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                         html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    
    let content = contentMatch ? contentMatch[1] : html;

    // Basic HTML to Markdown conversion
    content = content
      // Remove script and style tags
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      // Convert headers
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
      .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
      .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n')
      .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n')
      // Convert links
      .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
      // Convert code blocks
      .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n\n')
      .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
      // Convert lists
      .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, content) => {
        return content.replace(/<li[^>]*>(.*?)<\/li>/gi, '* $1\n') + '\n';
      })
      .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, content) => {
        let counter = 1;
        return content.replace(/<li[^>]*>(.*?)<\/li>/gi, () => `${counter++}. $1\n`) + '\n';
      })
      // Convert paragraphs
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
      // Convert line breaks
      .replace(/<br\s*\/?>/gi, '\n')
      // Remove remaining HTML tags
      .replace(/<[^>]+>/g, '')
      // Decode HTML entities
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      // Clean up extra whitespace
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();

    // Add source URL at the top
    return `# AWS Documentation\n\n**Source:** [${sourceUrl}](${sourceUrl})\n\n---\n\n${content}`;
  }

  // Format search results
  private formatSearchResults(results: any, query: string): string {
    if (!results.hits || !results.hits.hits || results.hits.hits.length === 0) {
      return `No results found for "${query}"`;
    }

    let formatted = `# Search Results for "${query}"\n\n`;
    formatted += `Found ${results.hits.total.value || results.hits.hits.length} results:\n\n`;

    results.hits.hits.forEach((hit: any, index: number) => {
      const source = hit._source || {};
      formatted += `## ${index + 1}. ${source.title || 'Untitled'}\n\n`;
      
      if (source.url) {
        formatted += `**URL:** [${source.url}](${source.url})\n\n`;
      }
      
      if (source.summary || source.description) {
        formatted += `**Summary:** ${source.summary || source.description}\n\n`;
      }

      if (source.service) {
        formatted += `**Service:** ${source.service}\n\n`;
      }

      formatted += '---\n\n';
    });

    return formatted;
  }

  // Generate content recommendations
  private async generateRecommendations(url: string): Promise<string> {
    // Extract service from URL
    const urlMatch = url.match(/docs\.aws\.amazon\.com\/([^\/]+)/);
    const service = urlMatch ? urlMatch[1] : null;

    if (!service) {
      return 'Unable to generate recommendations for this URL.';
    }

    // Generate related topics based on service
    const relatedTopics = this.getRelatedTopics(service);
    
    let recommendations = `# Content Recommendations\n\n`;
    recommendations += `Based on the current page about **${service}**, you might be interested in:\n\n`;

    relatedTopics.forEach((topic, index) => {
      recommendations += `${index + 1}. [${topic.title}](${topic.url})\n`;
      if (topic.description) {
        recommendations += `   ${topic.description}\n\n`;
      }
    });

    return recommendations;
  }

  // Get related topics for a service
  private getRelatedTopics(service: string): Array<{title: string; url: string; description?: string}> {
    // This would typically be a more sophisticated recommendation system
    // For now, return some common related topics
    const baseUrl = this.partition === 'aws' ? 'https://docs.aws.amazon.com' : 'https://docs.amazonaws.cn';
    
    return [
      {
        title: `${service.toUpperCase()} Getting Started Guide`,
        url: `${baseUrl}/${service}/latest/userguide/getting-started.html`,
        description: 'Learn the basics of this AWS service'
      },
      {
        title: `${service.toUpperCase()} Best Practices`,
        url: `${baseUrl}/${service}/latest/userguide/best-practices.html`,
        description: 'Recommended patterns and practices'
      },
      {
        title: `${service.toUpperCase()} API Reference`,
        url: `${baseUrl}/${service}/latest/api/`,
        description: 'Complete API documentation'
      }
    ];
  }

  // Fetch China services list
  private async fetchChinaServices(): Promise<string> {
    // In a real implementation, this would fetch from AWS China documentation
    const services = [
      'EC2 - Elastic Compute Cloud',
      'S3 - Simple Storage Service', 
      'RDS - Relational Database Service',
      'VPC - Virtual Private Cloud',
      'IAM - Identity and Access Management',
      'CloudFormation - Infrastructure as Code',
      'Lambda - Serverless Computing',
      'CloudWatch - Monitoring and Observability'
    ];

    let result = '# Available AWS Services in China\n\n';
    services.forEach((service, index) => {
      result += `${index + 1}. ${service}\n`;
    });

    return result;
  }
}