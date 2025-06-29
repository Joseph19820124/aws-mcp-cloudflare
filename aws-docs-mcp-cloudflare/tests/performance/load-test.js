// Performance test using k6
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('error_rate');
const responseTime = new Trend('response_time', true);

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up to 100 users
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 200 }, // Ramp up to 200 users
    { duration: '5m', target: 200 }, // Stay at 200 users
    { duration: '2m', target: 0 },   // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'], // 95% of requests must complete below 200ms
    http_req_failed: ['rate<0.01'],   // Error rate must be below 1%
    error_rate: ['rate<0.01'],        // Custom error rate below 1%
  },
};

// Test configuration
const BASE_URL = __ENV.BASE_URL || 'https://aws-docs-mcp-server.workers.dev';

// Test data
const testDocUrls = [
  'https://docs.aws.amazon.com/ec2/latest/userguide/concepts.html',
  'https://docs.aws.amazon.com/s3/latest/userguide/Welcome.html',
  'https://docs.aws.amazon.com/lambda/latest/dg/welcome.html',
  'https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html',
  'https://docs.aws.amazon.com/rds/latest/userguide/Welcome.html'
];

const searchQueries = [
  'S3 bucket',
  'EC2 instances',
  'Lambda functions',
  'VPC networking',
  'RDS database'
];

export function setup() {
  // Health check before starting tests
  const healthResponse = http.get(`${BASE_URL}/health`);
  check(healthResponse, {
    'health check status is 200': (r) => r.status === 200,
  });
  
  if (healthResponse.status !== 200) {
    throw new Error('Service is not healthy, aborting test');
  }
  
  console.log('Performance test setup complete');
  return { timestamp: Date.now() };
}

export default function() {
  const testType = Math.random();
  
  if (testType < 0.4) {
    // 40% - Test health endpoint
    testHealthEndpoint();
  } else if (testType < 0.6) {
    // 20% - Test tools list
    testToolsList();
  } else if (testType < 0.8) {
    // 20% - Test read documentation
    testReadDocumentation();
  } else if (testType < 0.9) {
    // 10% - Test search documentation
    testSearchDocumentation();
  } else {
    // 10% - Test SSE connection
    testSSEConnection();
  }
  
  sleep(1); // Think time between requests
}

function testHealthEndpoint() {
  const startTime = Date.now();
  const response = http.get(`${BASE_URL}/health`);
  const duration = Date.now() - startTime;
  
  const success = check(response, {
    'health status is 200': (r) => r.status === 200,
    'health response time < 100ms': () => duration < 100,
    'health response has timestamp': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.timestamp !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  errorRate.add(!success);
  responseTime.add(duration, { endpoint: 'health' });
}

function testToolsList() {
  const startTime = Date.now();
  const payload = {
    jsonrpc: '2.0',
    id: `test-${Date.now()}-${Math.random()}`,
    method: 'tools/list'
  };
  
  const response = http.post(`${BASE_URL}/mcp/message`, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  const duration = Date.now() - startTime;
  
  const success = check(response, {
    'tools/list status is 200': (r) => r.status === 200,
    'tools/list response time < 500ms': () => duration < 500,
    'tools/list has tools array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.result && Array.isArray(body.result.tools);
      } catch {
        return false;
      }
    },
  });
  
  errorRate.add(!success);
  responseTime.add(duration, { endpoint: 'tools/list' });
}

function testReadDocumentation() {
  const startTime = Date.now();
  const testUrl = testDocUrls[Math.floor(Math.random() * testDocUrls.length)];
  const payload = {
    jsonrpc: '2.0',
    id: `test-${Date.now()}-${Math.random()}`,
    method: 'tools/call',
    params: {
      name: 'read_documentation',
      arguments: { url: testUrl }
    }
  };
  
  const response = http.post(`${BASE_URL}/mcp/message`, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    timeout: '30s', // Longer timeout for documentation reading
  });
  
  const duration = Date.now() - startTime;
  
  const success = check(response, {
    'read_documentation status is 200': (r) => r.status === 200,
    'read_documentation response time < 5000ms': () => duration < 5000,
    'read_documentation has content': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.result && body.result.content && body.result.content.length > 0;
      } catch {
        return false;
      }
    },
  });
  
  errorRate.add(!success);
  responseTime.add(duration, { endpoint: 'read_documentation' });
}

function testSearchDocumentation() {
  const startTime = Date.now();
  const query = searchQueries[Math.floor(Math.random() * searchQueries.length)];
  const payload = {
    jsonrpc: '2.0',
    id: `test-${Date.now()}-${Math.random()}`,
    method: 'tools/call',
    params: {
      name: 'search_documentation',
      arguments: { 
        search_phrase: query,
        limit: 5
      }
    }
  };
  
  const response = http.post(`${BASE_URL}/mcp/message`, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    timeout: '30s',
  });
  
  const duration = Date.now() - startTime;
  
  const success = check(response, {
    'search_documentation status is 200': (r) => r.status === 200,
    'search_documentation response time < 3000ms': () => duration < 3000,
    'search_documentation has results': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.result && body.result.content && body.result.content.length > 0;
      } catch {
        return false;
      }
    },
  });
  
  errorRate.add(!success);
  responseTime.add(duration, { endpoint: 'search_documentation' });
}

function testSSEConnection() {
  // Test SSE endpoint availability
  const startTime = Date.now();
  const response = http.get(`${BASE_URL}/mcp/sse`, {
    headers: { 'Accept': 'text/event-stream' },
    timeout: '5s',
  });
  
  const duration = Date.now() - startTime;
  
  const success = check(response, {
    'SSE connection status is 200': (r) => r.status === 200,
    'SSE response time < 1000ms': () => duration < 1000,
    'SSE content-type is correct': (r) => r.headers['Content-Type'] && 
      r.headers['Content-Type'].includes('text/event-stream'),
  });
  
  errorRate.add(!success);
  responseTime.add(duration, { endpoint: 'sse' });
}

export function teardown(data) {
  console.log(`Performance test completed. Started at: ${new Date(data.timestamp)}`);
  
  // Final health check
  const finalHealthResponse = http.get(`${BASE_URL}/health`);
  check(finalHealthResponse, {
    'final health check status is 200': (r) => r.status === 200,
  });
}

// Export test scenarios for different use cases
export const scenarios = {
  // Light load scenario
  light_load: {
    executor: 'constant-vus',
    vus: 10,
    duration: '5m',
    tags: { test_type: 'light' },
  },
  
  // Spike test scenario
  spike_test: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '10s', target: 100 },
      { duration: '1m', target: 100 },
      { duration: '10s', target: 1000 }, // Spike
      { duration: '3m', target: 1000 },
      { duration: '10s', target: 100 },
      { duration: '3m', target: 100 },
      { duration: '10s', target: 0 },
    ],
    tags: { test_type: 'spike' },
  },
  
  // Stress test scenario
  stress_test: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '2m', target: 100 },
      { duration: '5m', target: 100 },
      { duration: '2m', target: 200 },
      { duration: '5m', target: 200 },
      { duration: '2m', target: 300 },
      { duration: '5m', target: 300 },
      { duration: '2m', target: 400 },
      { duration: '5m', target: 400 },
      { duration: '10m', target: 0 },
    ],
    tags: { test_type: 'stress' },
  }
};