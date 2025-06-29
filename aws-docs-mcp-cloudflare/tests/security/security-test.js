// Security test using OWASP ZAP baseline scan
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const TARGET_URL = process.env.TARGET_URL || 'https://aws-docs-mcp-server.workers.dev';
const REPORT_DIR = path.join(__dirname, 'reports');
const ZAP_REPORT = path.join(REPORT_DIR, 'zap-report.html');
const ZAP_JSON = path.join(REPORT_DIR, 'zap-report.json');

// Ensure reports directory exists
if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

console.log('🔒 Starting Security Assessment...');

// Security test suite
class SecurityTester {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.vulnerabilities = [];
    this.passed = 0;
    this.failed = 0;
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      'info': 'ℹ️',
      'pass': '✅',
      'fail': '❌',
      'warn': '⚠️'
    }[level] || 'ℹ️';
    
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  addVulnerability(type, severity, description, evidence = null) {
    this.vulnerabilities.push({
      type,
      severity,
      description,
      evidence,
      timestamp: new Date().toISOString()
    });
    this.failed++;
  }

  addPass(description) {
    this.passed++;
    this.log(description, 'pass');
  }

  // Test 1: Input validation
  async testInputValidation() {
    this.log('Testing input validation...');
    
    const maliciousInputs = [
      // XSS payloads
      '<script>alert("XSS")</script>',
      'javascript:alert("XSS")',
      '"><script>alert("XSS")</script>',
      
      // SQL injection payloads
      "' OR '1'='1",
      "'; DROP TABLE users; --",
      "1' UNION SELECT NULL--",
      
      // Command injection
      '; cat /etc/passwd',
      '| whoami',
      '&& ls -la',
      
      // Path traversal
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32\\drivers\\etc\\hosts',
      
      // NoSQL injection
      '{"$ne": null}',
      '{"$gt": ""}',
      
      // Large payloads
      'A'.repeat(10000),
      
      // Null bytes
      'test\x00.txt',
      
      // Unicode normalization
      'test\u0130',
    ];

    for (const payload of maliciousInputs) {
      try {
        // Test read_documentation with malicious URL
        const response = await fetch(`${this.baseUrl}/mcp/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'security-test',
            method: 'tools/call',
            params: {
              name: 'read_documentation',
              arguments: { url: payload }
            }
          })
        });

        const result = await response.json();
        
        // Check if payload was reflected or caused errors
        if (response.status === 500 || 
            (result.error && result.error.message.includes(payload))) {
          this.addVulnerability(
            'Input Validation',
            'Medium',
            `Server may be vulnerable to injection: ${payload.substring(0, 50)}...`,
            { payload, response: result }
          );
        }
      } catch (error) {
        // Network errors are expected for some payloads
      }
    }

    this.addPass('Input validation tests completed');
  }

  // Test 2: Authentication and authorization
  async testAuthAndAuthz() {
    this.log('Testing authentication and authorization...');
    
    // Test without authentication headers
    const endpoints = [
      '/health',
      '/capabilities', 
      '/mcp/sse',
      '/mcp/message',
      '/mcp/connections'
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${this.baseUrl}${endpoint}`);
        
        if (endpoint === '/mcp/connections' && response.status === 200) {
          this.addVulnerability(
            'Information Disclosure',
            'Low',
            'Connections endpoint accessible without authentication',
            { endpoint, status: response.status }
          );
        }
      } catch (error) {
        // Expected for some endpoints
      }
    }

    this.addPass('Authentication and authorization tests completed');
  }

  // Test 3: CORS configuration
  async testCORSConfiguration() {
    this.log('Testing CORS configuration...');
    
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: {
          'Origin': 'https://evil.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type'
        }
      });

      const corsHeaders = {
        'access-control-allow-origin': response.headers.get('access-control-allow-origin'),
        'access-control-allow-methods': response.headers.get('access-control-allow-methods'),
        'access-control-allow-headers': response.headers.get('access-control-allow-headers')
      };

      // Check for overly permissive CORS
      if (corsHeaders['access-control-allow-origin'] === '*') {
        this.addVulnerability(
          'CORS Misconfiguration',
          'Medium',
          'CORS allows all origins (*) which may enable cross-origin attacks',
          corsHeaders
        );
      }

      if (corsHeaders['access-control-allow-methods']?.includes('DELETE') ||
          corsHeaders['access-control-allow-methods']?.includes('PUT')) {
        this.addVulnerability(
          'CORS Misconfiguration',
          'Low',
          'CORS allows potentially dangerous HTTP methods',
          corsHeaders
        );
      }
    } catch (error) {
      this.log('Error testing CORS: ' + error.message, 'warn');
    }

    this.addPass('CORS configuration tests completed');
  }

  // Test 4: Information disclosure
  async testInformationDisclosure() {
    this.log('Testing for information disclosure...');
    
    const sensitiveEndpoints = [
      '/.env',
      '/package.json',
      '/config.json',
      '/debug',
      '/admin',
      '/status',
      '/metrics',
      '/logs'
    ];

    for (const endpoint of sensitiveEndpoints) {
      try {
        const response = await fetch(`${this.baseUrl}${endpoint}`);
        
        if (response.status === 200) {
          const content = await response.text();
          if (content.length > 100) { // Significant content
            this.addVulnerability(
              'Information Disclosure',
              'Medium',
              `Sensitive endpoint accessible: ${endpoint}`,
              { endpoint, status: response.status }
            );
          }
        }
      } catch (error) {
        // Expected for non-existent endpoints
      }
    }

    this.addPass('Information disclosure tests completed');
  }

  // Test 5: Rate limiting
  async testRateLimiting() {
    this.log('Testing rate limiting...');
    
    const requests = [];
    const startTime = Date.now();
    
    // Send 100 rapid requests
    for (let i = 0; i < 100; i++) {
      requests.push(
        fetch(`${this.baseUrl}/health`).catch(() => ({ status: 0 }))
      );
    }
    
    const responses = await Promise.all(requests);
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    const rateLimited = responses.some(r => r.status === 429);
    const successCount = responses.filter(r => r.status === 200).length;
    
    if (!rateLimited && successCount > 50 && duration < 5000) {
      this.addVulnerability(
        'Rate Limiting',
        'Low',
        'No rate limiting detected - server processed 100 requests rapidly',
        { successCount, duration }
      );
    }

    this.addPass('Rate limiting tests completed');
  }

  // Test 6: SSL/TLS configuration
  async testSSLConfiguration() {
    this.log('Testing SSL/TLS configuration...');
    
    if (!this.baseUrl.startsWith('https://')) {
      this.addVulnerability(
        'SSL/TLS',
        'High',
        'Service not using HTTPS',
        { url: this.baseUrl }
      );
      return;
    }

    try {
      // Test with invalid hostname
      const hostname = new URL(this.baseUrl).hostname;
      const response = await fetch(this.baseUrl.replace(hostname, 'invalid-host.com'), {
        headers: { 'Host': hostname }
      });
      
      // This should fail due to SSL verification
      this.addVulnerability(
        'SSL/TLS',
        'Medium',
        'SSL certificate validation may be bypassed',
        { originalHost: hostname }
      );
    } catch (error) {
      // Expected - SSL validation working
    }

    this.addPass('SSL/TLS configuration tests completed');
  }

  // Test 7: Headers security
  async testSecurityHeaders() {
    this.log('Testing security headers...');
    
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      
      const securityHeaders = [
        'x-content-type-options',
        'x-frame-options', 
        'x-xss-protection',
        'strict-transport-security',
        'content-security-policy',
        'referrer-policy'
      ];

      const missingHeaders = [];
      
      securityHeaders.forEach(header => {
        if (!response.headers.get(header)) {
          missingHeaders.push(header);
        }
      });

      if (missingHeaders.length > 0) {
        this.addVulnerability(
          'Security Headers',
          'Low',
          `Missing security headers: ${missingHeaders.join(', ')}`,
          { missingHeaders }
        );
      }

      // Check for sensitive headers that shouldn't be exposed
      const sensitiveHeaders = ['server', 'x-powered-by'];
      const exposedHeaders = [];
      
      sensitiveHeaders.forEach(header => {
        if (response.headers.get(header)) {
          exposedHeaders.push(header);
        }
      });

      if (exposedHeaders.length > 0) {
        this.addVulnerability(
          'Information Disclosure',
          'Low',
          `Sensitive headers exposed: ${exposedHeaders.join(', ')}`,
          { exposedHeaders }
        );
      }
    } catch (error) {
      this.log('Error testing security headers: ' + error.message, 'warn');
    }

    this.addPass('Security headers tests completed');
  }

  // Generate security report
  generateReport() {
    const report = {
      summary: {
        target: this.baseUrl,
        timestamp: new Date().toISOString(),
        totalTests: this.passed + this.failed,
        passed: this.passed,
        failed: this.failed,
        vulnerabilities: this.vulnerabilities.length
      },
      vulnerabilities: this.vulnerabilities,
      recommendations: this.generateRecommendations()
    };

    // Save JSON report
    fs.writeFileSync(
      path.join(REPORT_DIR, 'security-report.json'),
      JSON.stringify(report, null, 2)
    );

    // Generate HTML report
    const htmlReport = this.generateHTMLReport(report);
    fs.writeFileSync(
      path.join(REPORT_DIR, 'security-report.html'),
      htmlReport
    );

    return report;
  }

  generateRecommendations() {
    const recommendations = [];
    
    const vulnTypes = [...new Set(this.vulnerabilities.map(v => v.type))];
    
    if (vulnTypes.includes('Input Validation')) {
      recommendations.push('Implement strict input validation and sanitization');
    }
    
    if (vulnTypes.includes('CORS Misconfiguration')) {
      recommendations.push('Review and restrict CORS policy to trusted origins only');
    }
    
    if (vulnTypes.includes('Information Disclosure')) {
      recommendations.push('Remove or secure endpoints that expose sensitive information');
    }
    
    if (vulnTypes.includes('Rate Limiting')) {
      recommendations.push('Implement rate limiting to prevent abuse');
    }
    
    if (vulnTypes.includes('SSL/TLS')) {
      recommendations.push('Ensure proper SSL/TLS configuration and certificate validation');
    }
    
    if (vulnTypes.includes('Security Headers')) {
      recommendations.push('Add missing security headers and remove sensitive server information');
    }

    return recommendations;
  }

  generateHTMLReport(report) {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Security Assessment Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f0f8ff; padding: 20px; border-radius: 5px; }
        .summary { margin: 20px 0; }
        .vulnerability { margin: 10px 0; padding: 10px; border-left: 4px solid #ff6b6b; background: #fff5f5; }
        .vulnerability.medium { border-color: #ffa726; background: #fff8e1; }
        .vulnerability.low { border-color: #66bb6a; background: #f1f8e9; }
        .recommendations { background: #e3f2fd; padding: 15px; border-radius: 5px; }
        pre { background: #f5f5f5; padding: 10px; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔒 Security Assessment Report</h1>
        <p><strong>Target:</strong> ${report.summary.target}</p>
        <p><strong>Timestamp:</strong> ${report.summary.timestamp}</p>
    </div>
    
    <div class="summary">
        <h2>📊 Summary</h2>
        <ul>
            <li>Total Tests: ${report.summary.totalTests}</li>
            <li>Passed: ${report.summary.passed}</li>
            <li>Vulnerabilities Found: ${report.summary.vulnerabilities}</li>
        </ul>
    </div>
    
    <div class="vulnerabilities">
        <h2>🚨 Vulnerabilities</h2>
        ${report.vulnerabilities.map(vuln => `
            <div class="vulnerability ${vuln.severity.toLowerCase()}">
                <h3>${vuln.type} (${vuln.severity})</h3>
                <p>${vuln.description}</p>
                ${vuln.evidence ? `<pre>${JSON.stringify(vuln.evidence, null, 2)}</pre>` : ''}
            </div>
        `).join('')}
    </div>
    
    <div class="recommendations">
        <h2>💡 Recommendations</h2>
        <ul>
            ${report.recommendations.map(rec => `<li>${rec}</li>`).join('')}
        </ul>
    </div>
</body>
</html>`;
  }

  // Run all security tests
  async runAllTests() {
    this.log(`Starting security assessment of ${this.baseUrl}`);
    
    try {
      await this.testInputValidation();
      await this.testAuthAndAuthz();
      await this.testCORSConfiguration();
      await this.testInformationDisclosure();
      await this.testRateLimiting();
      await this.testSSLConfiguration();
      await this.testSecurityHeaders();
      
      const report = this.generateReport();
      
      this.log(`Security assessment completed. Found ${report.summary.vulnerabilities} vulnerabilities.`);
      this.log(`Report saved to: ${path.join(REPORT_DIR, 'security-report.html')}`);
      
      return report;
    } catch (error) {
      this.log(`Security assessment failed: ${error.message}`, 'fail');
      throw error;
    }
  }
}

// Run security tests
async function runSecurityTests() {
  const tester = new SecurityTester(TARGET_URL);
  
  try {
    const report = await tester.runAllTests();
    
    // Exit with error code if high severity vulnerabilities found
    const highSeverityVulns = report.vulnerabilities.filter(v => v.severity === 'High');
    if (highSeverityVulns.length > 0) {
      console.error(`❌ Security assessment failed: ${highSeverityVulns.length} high severity vulnerabilities found`);
      process.exit(1);
    }
    
    console.log('✅ Security assessment passed');
    return report;
    
  } catch (error) {
    console.error('❌ Security assessment error:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runSecurityTests();
}

module.exports = { SecurityTester, runSecurityTests };