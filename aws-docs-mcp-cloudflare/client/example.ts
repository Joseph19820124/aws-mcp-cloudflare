import SSEMCPClient from './sse-mcp-client';

async function main() {
  // Create client instance
  const client = new SSEMCPClient({
    baseUrl: 'http://localhost:8787', // For local development
    // baseUrl: 'https://aws-docs-mcp-server.your-subdomain.workers.dev', // For production
    debug: true,
    timeout: 30000,
    maxReconnectAttempts: 5
  });

  try {
    console.log('🚀 Connecting to AWS Docs MCP Server...');
    
    // Connect to server
    await client.connect();
    console.log('✅ Connected successfully!');

    // Initialize MCP session
    console.log('🔧 Initializing MCP session...');
    const initResult = await client.initialize({
      name: 'AWS-Docs-CLI-Client',
      version: '1.0.0'
    });
    console.log('📋 Server info:', initResult.serverInfo);

    // List available tools
    console.log('🛠️ Fetching available tools...');
    const tools = await client.listTools();
    console.log('📋 Available tools:', tools.tools.map((t: any) => t.name).join(', '));

    // Example 1: Read AWS documentation
    console.log('\n📖 Example 1: Reading AWS EC2 documentation...');
    try {
      const ec2Docs = await client.readDocumentation('https://docs.aws.amazon.com/ec2/latest/userguide/concepts.html');
      console.log('📄 Document content (first 500 chars):');
      console.log(ec2Docs.substring(0, 500) + '...');
    } catch (error) {
      console.error('❌ Error reading documentation:', error);
    }

    // Example 2: Search documentation (Global partition only)
    if (tools.tools.some((t: any) => t.name === 'search_documentation')) {
      console.log('\n🔍 Example 2: Searching for "S3 bucket"...');
      try {
        const searchResults = await client.searchDocumentation('S3 bucket', 5);
        console.log('🔎 Search results:');
        console.log(searchResults.substring(0, 1000) + '...');
      } catch (error) {
        console.error('❌ Error searching documentation:', error);
      }
    }

    // Example 3: Get recommendations (Global partition only)
    if (tools.tools.some((t: any) => t.name === 'recommend')) {
      console.log('\n💡 Example 3: Getting recommendations for Lambda documentation...');
      try {
        const recommendations = await client.getRecommendations('https://docs.aws.amazon.com/lambda/latest/dg/welcome.html');
        console.log('🎯 Recommendations:');
        console.log(recommendations);
      } catch (error) {
        console.error('❌ Error getting recommendations:', error);
      }
    }

    // Example 4: Get available services (China partition only)
    if (tools.tools.some((t: any) => t.name === 'get_available_services')) {
      console.log('\n🌏 Example 4: Getting available services in China...');
      try {
        const services = await client.getAvailableServices();
        console.log('🏢 Available services:');
        console.log(services);
      } catch (error) {
        console.error('❌ Error getting services:', error);
      }
    }

    console.log('\n✅ All examples completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    // Clean up
    console.log('🧹 Disconnecting...');
    client.disconnect();
    console.log('👋 Goodbye!');
  }
}

// Run the example
if (require.main === module) {
  main().catch(console.error);
}

export { main };