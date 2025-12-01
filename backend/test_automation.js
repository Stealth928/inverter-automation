const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

async function runTest() {
    console.log('--- Starting Automation Rule Test (Dry Run) ---');

    // 1. Load Mock Data
    const mockFile = path.join(__dirname, 'mock_amber.json');
    if (!fs.existsSync(mockFile)) {
        console.error('Mock file not found:', mockFile);
        return;
    }
    
    const amberData = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
    console.log(`Loaded mock data from ${path.basename(mockFile)}`);

    // 2. Send to Test Endpoint using built-in fetch
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    try {
        const response = await fetch(`${BASE_URL}/api/automation/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amberData }),
            signal: controller.signal
        });
        clearTimeout(timeout);
        
        const result = await response.json();
        console.log('Test Result:', JSON.stringify(result, null, 2));
        
    } catch (error) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
            console.error('Test timed out after 10 seconds. Is the server running?');
        } else {
            console.error('Test failed:', error.message);
        }
    }
}

runTest();
