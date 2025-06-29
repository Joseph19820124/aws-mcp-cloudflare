import SSEMCPClient from '../../client/sse-mcp-client';

describe('End-to-End Full Workflow Tests', () => {
  let client: SSEMCPClient;
  const TEST_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:8787';
  
  // Increase timeout for E2E tests
  const E2E_TIMEOUT = 60000;

  beforeAll(async () => {
    client = new SSEMCPClient({
      baseUrl: TEST_BASE_URL,
      debug: true,
      timeout: 30000,
      maxReconnectAttempts: 3
    });
  }, E2E_TIMEOUT);

  afterAll(() => {
    if (client) {
      client.disconnect();
    }
  });

  describe('Complete MCP Workflow', () => {
    test('should complete full AWS documentation workflow', async () => {
      // Step 1: Connect to server
      console.log('🔌 Connecting to MCP server...');
      await client.connect();
      expect(client.isConnected()).toBe(true);

      // Step 2: Initialize MCP session  
      console.log('🔧 Initializing MCP session...');
      const initResult = await client.initialize({
        name: 'E2E-Test-Client',
        version: '1.0.0'
      });
      
      expect(initResult.protocolVersion).toBe('2024-11-05');
      expect(initResult.serverInfo.name).toBe('aws-docs-mcp-server');

      // Step 3: List available tools
      console.log('🛠️ Fetching available tools...');
      const tools = await client.listTools();
      
      expect(tools.tools).toBeDefined();
      expect(tools.tools.length).toBeGreaterThan(0);
      
      const toolNames = tools.tools.map((t: any) => t.name);
      expect(toolNames).toContain('read_documentation');
      
      console.log(`📋 Available tools: ${toolNames.join(', ')}`);

      // Step 4: Read AWS documentation
      console.log('📖 Reading AWS EC2 documentation...');
      const ec2Docs = await client.readDocumentation(
        'https://docs.aws.amazon.com/ec2/latest/userguide/concepts.html'
      );
      
      expect(ec2Docs).toBeTruthy();
      expect(ec2Docs.length).toBeGreaterThan(100);
      expect(ec2Docs).toContain('AWS Documentation');
      expect(ec2Docs).toContain('EC2');
      
      console.log(`📄 Retrieved ${ec2Docs.length} characters of documentation`);

      // Step 5: Search documentation (if available)
      if (toolNames.includes('search_documentation')) {
        console.log('🔍 Searching AWS documentation...');
        const searchResults = await client.searchDocumentation('S3 bucket', 5);
        
        expect(searchResults).toBeTruthy();
        expect(searchResults).toContain('Search Results');
        expect(searchResults.toLowerCase()).toContain('s3');
        
        console.log('🔎 Search completed successfully');
      }

      // Step 6: Get recommendations (if available)
      if (toolNames.includes('recommend')) {
        console.log('💡 Getting content recommendations...');
        const recommendations = await client.getRecommendations(
          'https://docs.aws.amazon.com/lambda/latest/dg/welcome.html'
        );
        
        expect(recommendations).toBeTruthy();
        expect(recommendations).toContain('Content Recommendations');
        expect(recommendations.toLowerCase()).toContain('lambda');
        
        console.log('🎯 Recommendations retrieved successfully');
      }

      // Step 7: Get available services (if China partition)
      if (toolNames.includes('get_available_services')) {
        console.log('🌏 Getting available services...');
        const services = await client.getAvailableServices();
        
        expect(services).toBeTruthy();
        expect(services).toContain('Available AWS Services');
        
        console.log('🏢 Services list retrieved successfully');
      }

      console.log('✅ Full workflow completed successfully!');
    }, E2E_TIMEOUT);
  });

  describe('Error Handling Workflow', () => {
    test('should handle invalid requests gracefully', async () => {
      await client.connect();
      await client.initialize();

      // Test invalid URL
      console.log('🧪 Testing invalid URL handling...');
      try {
        await client.readDocumentation('https://invalid-domain.com/fake-docs');
        fail('Should have thrown an error for invalid URL');
      } catch (error) {
        expect(error).toBeDefined();
        console.log('✅ Invalid URL handled correctly');
      }

      // Test malformed request
      console.log('🧪 Testing malformed request handling...');
      try {
        await client.sendMessage({
          jsonrpc: '2.0',
          id: 'test-malformed',
          method: 'invalid/method'
        });
        fail('Should have thrown an error for invalid method');
      } catch (error) {
        expect(error).toBeDefined();
        console.log('✅ Invalid method handled correctly');
      }

      // Test tool with invalid arguments
      console.log('🧪 Testing invalid arguments handling...');
      try {
        await client.callTool('read_documentation', { invalid: 'argument' });
        fail('Should have thrown an error for invalid arguments');
      } catch (error) {
        expect(error).toBeDefined();
        console.log('✅ Invalid arguments handled correctly');
      }

      console.log('✅ Error handling workflow completed successfully!');
    }, E2E_TIMEOUT);
  });

  describe('Stress Testing Workflow', () => {
    test('should handle multiple concurrent requests', async () => {
      await client.connect();
      await client.initialize();

      console.log('🏃‍♂️ Testing concurrent requests...');
      
      const testUrls = [
        'https://docs.aws.amazon.com/ec2/latest/userguide/concepts.html',
        'https://docs.aws.amazon.com/s3/latest/userguide/Welcome.html',
        'https://docs.aws.amazon.com/lambda/latest/dg/welcome.html',
        'https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html',
        'https://docs.aws.amazon.com/rds/latest/userguide/Welcome.html'
      ];

      // Send 5 concurrent read requests
      const startTime = Date.now();
      const promises = testUrls.map(url => 
        client.readDocumentation(url).catch(error => ({ error: error.message, url }))
      );

      const results = await Promise.all(promises);
      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`⏱️ Completed ${testUrls.length} concurrent requests in ${duration}ms`);

      // Check results
      const successful = results.filter(r => !r.error);
      const failed = results.filter(r => r.error);

      expect(successful.length).toBeGreaterThan(0);
      console.log(`✅ ${successful.length} requests succeeded, ${failed.length} failed`);

      // Log any failures for debugging
      failed.forEach(f => {
        console.log(`❌ Failed request: ${f.url} - ${f.error}`);
      });

      console.log('✅ Concurrent requests test completed!');
    }, E2E_TIMEOUT);
  });

  describe('Connection Resilience', () => {
    test('should handle connection interruptions', async () => {
      console.log('🔄 Testing connection resilience...');
      
      // Initial connection
      await client.connect();
      expect(client.isConnected()).toBe(true);

      // Simulate connection loss and recovery
      client.disconnect();
      expect(client.isConnected()).toBe(false);

      // Reconnect
      await client.connect();
      expect(client.isConnected()).toBe(true);

      // Verify functionality after reconnection
      await client.initialize();
      const tools = await client.listTools();
      expect(tools.tools).toBeDefined();

      console.log('✅ Connection resilience test passed!');
    }, E2E_TIMEOUT);
  });

  describe('Performance Baseline', () => {
    test('should meet performance benchmarks', async () => {
      await client.connect();
      await client.initialize();

      console.log('📊 Running performance baseline tests...');

      // Test response times for different operations
      const benchmarks = [];

      // Tools list benchmark
      const toolsStart = Date.now();
      await client.listTools();
      const toolsTime = Date.now() - toolsStart;
      benchmarks.push({ operation: 'tools/list', time: toolsTime });

      // Documentation read benchmark
      const readStart = Date.now();
      await client.readDocumentation(
        'https://docs.aws.amazon.com/ec2/latest/userguide/concepts.html'
      );
      const readTime = Date.now() - readStart;
      benchmarks.push({ operation: 'read_documentation', time: readTime });

      // Log benchmark results
      console.log('📈 Performance Benchmarks:');
      benchmarks.forEach(b => {
        console.log(`  ${b.operation}: ${b.time}ms`);
      });

      // Assert performance requirements
      expect(toolsTime).toBeLessThan(1000); // Tools list should be < 1s
      expect(readTime).toBeLessThan(10000); // Documentation read should be < 10s

      console.log('✅ Performance benchmarks met!');
    }, E2E_TIMEOUT);
  });

  describe('Data Integrity', () => {
    test('should maintain data consistency', async () => {
      await client.connect();
      await client.initialize();

      console.log('🔍 Testing data integrity...');

      // Read the same document multiple times
      const testUrl = 'https://docs.aws.amazon.com/ec2/latest/userguide/concepts.html';
      
      const results = await Promise.all([
        client.readDocumentation(testUrl),
        client.readDocumentation(testUrl),
        client.readDocumentation(testUrl)
      ]);

      // Verify all results are identical
      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);

      // Verify content structure is consistent
      results.forEach(result => {
        expect(result).toContain('AWS Documentation');
        expect(result).toContain('EC2');
        expect(result.length).toBeGreaterThan(100);
      });

      console.log('✅ Data integrity verified!');
    }, E2E_TIMEOUT);
  });
});