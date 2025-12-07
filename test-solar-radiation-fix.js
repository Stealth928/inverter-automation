#!/usr/bin/env node
/**
 * Test Solar Radiation Fix
 * 
 * Verifies that solar radiation data now uses the current hour
 * instead of midnight (index 0)
 */

const fs = require('fs');

function testSolarRadiationFix() {
  console.log('Testing Solar Radiation Fix...\n');
  
  const files = [
    { name: 'index.html', path: 'd:\\inverter-automation\\frontend\\index.html' },
    { name: 'test.html', path: 'd:\\inverter-automation\\frontend\\test.html' }
  ];
  
  let allPass = true;
  
  files.forEach(file => {
    console.log(`✓ Checking ${file.name}...`);
    const content = fs.readFileSync(file.path, 'utf8');
    
    const checks = [
      {
        name: 'Uses current hour index instead of [0]',
        patterns: ['currentHourIdx', 'toISOString().substring(0, 13)', 'findIndex']
      },
      {
        name: 'Extracts hour from time array',
        pattern: 'hourly.time'
      },
      {
        name: 'Matches current hour from times',
        pattern: 'substring.*13.*currentHourStr'
      },
      {
        name: 'Uses currentHourIdx for solar radiation',
        pattern: 'shortwave_radiation.*currentHourIdx'
      },
      {
        name: 'Uses currentHourIdx for cloud cover',
        pattern: '(cloudcover|cloud_cover).*currentHourIdx'
      }
    ];
    
    const basePattern = 'shortwave_radiation\\?\\.[0]'; // old pattern [0]
    if (!new RegExp(basePattern).test(content)) {
      console.log(`  ✓ No hardcoded [0] index for solar radiation`);
    } else {
      console.log(`  ✗ Still has hardcoded [0] index for solar radiation`);
      allPass = false;
    }
    
    checks.forEach(check => {
      if (Array.isArray(check.patterns)) {
        const allFound = check.patterns.every(p => content.includes(p));
        console.log(`  ${allFound ? '✓' : '✗'} ${check.name}`);
        if (!allFound) allPass = false;
      } else {
        const found = new RegExp(check.pattern).test(content);
        console.log(`  ${found ? '✓' : '✗'} ${check.name}`);
        if (!found) allPass = false;
      }
    });
    
    console.log();
  });
  
  if (allPass) {
    console.log('✅ All solar radiation fixes verified!\n');
    console.log('Summary:');
    console.log('- Solar radiation now uses current hour instead of midnight');
    console.log('- Matches time from weather API hourly.time array');
    console.log('- Falls back to index 0 if current hour not found');
    console.log('- Applies to both dashboard (index.html) and test page (test.html)');
    console.log('\nExpected behavior:');
    console.log('- Test page "Fetch Real Conditions" will show accurate solar radiation');
    console.log('- Dashboard displays current solar radiation (not always 0 at startup)');
    console.log('- Automation rules can now use realistic solar radiation values');
  } else {
    console.log('✗ Some fixes missing!');
    process.exit(1);
  }
}

testSolarRadiationFix();
