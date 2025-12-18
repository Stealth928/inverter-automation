#!/usr/bin/env node

/**
 * Debug script to verify metrics API authentication flow
 * Tests whether the Authorization header is properly sent and verified
 */

const http = require('http');
const https = require('https');

async function testMetricsEndpoint(baseUrl, authToken) {
  console.log(`\n=== Testing Metrics Endpoint ===`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Token: ${authToken ? `${authToken.substring(0, 20)}...` : 'none'}`);

  return new Promise((resolve) => {
    const url = new URL('/api/metrics/api-calls?days=1&scope=user', baseUrl);
    const client = url.protocol === 'https:' ? https : http;

    const options = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (authToken) {
      options.headers['Authorization'] = `Bearer ${authToken}`;
      console.log(`✓ Adding Authorization header: Bearer ${authToken.substring(0, 20)}...`);
    } else {
      console.log(`✗ No auth token provided`);
    }

    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log(`\nResponse Status: ${res.status} ${res.statusMessage}`);
        console.log(`Response Headers:`, res.headers);
        try {
          const parsed = JSON.parse(data);
          console.log(`\nResponse Body:`, JSON.stringify(parsed, null, 2));
          resolve(parsed);
        } catch (e) {
          console.log(`\nResponse Body (non-JSON):`, data.substring(0, 200));
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.error(`Request error:`, err.message);
      resolve(null);
    });

    req.end();
  });
}

async function main() {
  const baseUrl = process.env.API_URL || 'http://localhost:5001';
  const token = process.env.AUTH_TOKEN;

  console.log(`Testing metrics API authentication...`);
  console.log(`Using base URL: ${baseUrl}`);

  // Test 1: Without auth
  console.log(`\n--- TEST 1: No Authorization Header ---`);
  await testMetricsEndpoint(baseUrl, null);

  // Test 2: With auth
  if (token) {
    console.log(`\n--- TEST 2: With Authorization Header ---`);
    await testMetricsEndpoint(baseUrl, token);
  } else {
    console.log(`\n--- TEST 2: Skipped (no AUTH_TOKEN provided) ---`);
    console.log(`Set AUTH_TOKEN environment variable to test authenticated requests`);
  }
}

main().catch(console.error);
