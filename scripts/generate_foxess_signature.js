#!/usr/bin/env node
// Simple helper to compute FoxESS signature (literal \\r\\n) and show a sample curl command
const crypto = require('crypto');

function usage() {
  console.log('Usage: node scripts/generate_foxess_signature.js <apiPath> <token> [timestamp]');
  console.log('Example: node scripts/generate_foxess_signature.js /op/v0/device/list a470aead-...');
  process.exit(1);
}

if (process.argv.length < 4) usage();

const apiPath = process.argv[2];
let token = process.argv[3];
const timestamp = process.argv[4] || Date.now().toString();

// Clean token (strip whitespace/nonprintable) to match Postman & server behavior
if (typeof token === 'string') {
  token = token.trim().replace(/\s+/g, '').replace(/[^\x20-\x7E]/g, '');
}

const signaturePlain = `${apiPath}\\r\\n${token}\\r\\n${timestamp}`;
const signature = crypto.createHash('md5').update(signaturePlain).digest('hex');

console.log('Plain text (for MD5 input):', signaturePlain);
console.log('MD5 signature:', signature);
console.log('--- sample curl ---');
console.log(`curl -s -X POST "https://www.foxesscloud.com${apiPath}" \\
  -H "token: ${token}" \\
  -H "timestamp: ${timestamp}" \\
  -H "signature: ${signature}" \\
  -H "lang: en" \\
  -H "Content-Type: application/json" \\
  -d '{ "currentPage": 1, "pageSize": 10 }'`);
