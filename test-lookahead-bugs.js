/**
 * Test script to demonstrate lookAhead bugs in radiation, cloud cover, and forecast price conditions
 * 
 * BUGS FOUND:
 * 1. Solar Radiation: Uses wrong index - starts from CURRENT hour but should start from NEXT hour
 * 2. Cloud Cover: Same issue - starts from CURRENT hour but should start from NEXT hour
 * 3. Forecast Price: Correctly uses 5-min intervals but...
 * 4. ALL: When at edge of data (e.g., 23:00 asking for next 6 hours), the slice may only get 1 hour
 * 5. ALL: No validation that we actually got the requested timeframe
 */

// Simulate weather API response with hourly data
function generateMockWeatherData() {
  const now = new Date('2025-12-08T14:00:00Z'); // 14:00 UTC
  const hourly = {
    time: [],
    shortwave_radiation: [],
    cloudcover: []
  };

  // Generate 48 hours of data starting from current hour
  for (let i = 0; i < 48; i++) {
    const hour = new Date(now);
    hour.setHours(hour.getHours() + i);
    hourly.time.push(hour.toISOString());
    
    // Mock radiation data: 0 at night, peaks at noon
    const hourOfDay = hour.getHours();
    const radiation = hourOfDay >= 6 && hourOfDay <= 18 ? (100 + (hourOfDay - 6) * 40) : 0;
    hourly.shortwave_radiation.push(radiation);
    
    // Mock cloud cover: 50% average
    hourly.cloudcover.push(50 + Math.sin(i / 8) * 20);
  }

  return { hourly, now };
}

// Bug #1: Solar Radiation index calculation
function testSolarRadiationBug() {
  console.log('\n=== BUG #1: Solar Radiation Lookhead ===');
  const { hourly, now } = generateMockWeatherData();
  
  console.log(`\nCurrent time: ${now.toISOString()} (${now.getHours()}:00 UTC)`);
  console.log(`Requesting: Next 6 hours of solar radiation data`);
  
  // Current buggy logic
  const currentHour = now.getHours();
  let startIdx = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    const t = new Date(hourly.time[i]);
    if (t.getHours() >= currentHour && t.getDate() === now.getDate()) {
      startIdx = i;
      break;
    }
  }
  
  console.log(`\n🔴 BUGGY LOGIC:`);
  console.log(`  - currentHour = ${currentHour}`);
  console.log(`  - startIdx = ${startIdx}`);
  console.log(`  - hourly.time[${startIdx}] = ${hourly.time[startIdx]}`);
  console.log(`  - This is the CURRENT hour, not the NEXT hour!`);
  
  const lookAheadHours = 6;
  const endIdx = Math.min(startIdx + lookAheadHours, hourly.shortwave_radiation.length);
  const radiationValues = hourly.shortwave_radiation.slice(startIdx, endIdx);
  
  console.log(`\n  Slice: [${startIdx}, ${endIdx})`);
  console.log(`  Hours checked: ${radiationValues.length}`);
  console.log(`  Data included:`);
  for (let i = startIdx; i < endIdx && i < hourly.time.length; i++) {
    const t = new Date(hourly.time[i]);
    console.log(`    ${t.getHours()}:00 UTC - ${radiationValues[i-startIdx]} W/m²`);
  }
  
  console.log(`\n✅ CORRECT LOGIC should be:`);
  console.log(`  - Look ahead STARTING FROM NEXT HOUR`);
  console.log(`  - startIdx should be ${startIdx + 1} (skip current hour)`);
  const correctStartIdx = startIdx + 1;
  const correctEndIdx = Math.min(correctStartIdx + lookAheadHours, hourly.shortwave_radiation.length);
  const correctRadiationValues = hourly.shortwave_radiation.slice(correctStartIdx, correctEndIdx);
  
  console.log(`\n  Correct slice: [${correctStartIdx}, ${correctEndIdx})`);
  console.log(`  Hours checked: ${correctRadiationValues.length}`);
  console.log(`  Data that SHOULD be included:`);
  for (let i = correctStartIdx; i < correctEndIdx && i < hourly.time.length; i++) {
    const t = new Date(hourly.time[i]);
    console.log(`    ${t.getHours()}:00 UTC - ${correctRadiationValues[i-correctStartIdx]} W/m²`);
  }
  
  console.log(`\n⚠️  IMPACT: Current hour is incorrectly included in the forecast!`);
  console.log(`   If user says "next 6 hours", they get current hour + 5 future hours (wrong)`);
  console.log(`   Should get: 6 hours into the future (starting from next hour)`);
}

// Bug #2: Cloud Cover has same issue
function testCloudCoverBug() {
  console.log('\n\n=== BUG #2: Cloud Cover Lookhead (same as radiation) ===');
  const { hourly, now } = generateMockWeatherData();
  
  console.log(`Current time: ${now.toISOString()} (${now.getHours()}:00 UTC)`);
  console.log(`Requesting: Next 12 hours of cloud cover data`);
  
  // Current buggy logic (identical to radiation)
  const currentHour = now.getHours();
  let startIdx = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    const t = new Date(hourly.time[i]);
    if (t.getHours() >= currentHour && t.getDate() === now.getDate()) {
      startIdx = i;
      break;
    }
  }
  
  console.log(`\n🔴 BUGGY LOGIC: startIdx = ${startIdx} (CURRENT hour included)`);
  
  const lookAheadHours = 12;
  const endIdx = Math.min(startIdx + lookAheadHours, hourly.cloudcover.length);
  const cloudValues = hourly.cloudcover.slice(startIdx, endIdx);
  
  console.log(`  Hours checked: ${cloudValues.length} (should be 12)`);
  console.log(`  First hour in result: ${hourly.time[startIdx]}`);
  
  console.log(`\n✅ CORRECT: startIdx should be ${startIdx + 1} to skip current hour`);
  console.log(`   Only then count forward 12 hours`);
}

// Bug #3: Forecast Price has a different but related issue
function testForecastPriceBug() {
  console.log('\n\n=== BUG #3: Forecast Price Time Window ===');
  
  // Simulate Amber forecast data (5-min intervals)
  const forecasts = [
    { time: '14:00-14:05', perKwh: 25, type: 'ForecastInterval' },
    { time: '14:05-14:10', perKwh: 26, type: 'ForecastInterval' },
    { time: '14:10-14:15', perKwh: 27, type: 'ForecastInterval' },
    // ... imagine 12 intervals = 1 hour ahead
  ];
  
  const now = new Date('2025-12-08T14:03:00Z'); // 14:03 UTC
  console.log(`\nCurrent time: ${now.toISOString()} (14:03:00 UTC)`);
  console.log(`Requesting: Next 1 hour of prices`);
  
  const lookAheadMinutes = 60;
  const intervalsNeeded = Math.ceil(lookAheadMinutes / 5); // = 12 intervals
  const forecasts_used = forecasts.slice(0, intervalsNeeded);
  
  console.log(`\n🔴 ISSUE: The code uses slice(0, 12) which gets ALL 12 intervals`);
  console.log(`   But we're at 14:03, so we should skip the partial 14:00-14:05 interval`);
  console.log(`   and the partial 14:05-14:10 interval`);
  console.log(`   We should start from 14:10-14:15 and get next 12 full intervals`);
  console.log(`   This would be 14:10 through 15:00 (but API has limited lookahead)`);
  
  console.log(`\n✅ ANALYSIS: Amber API only provides ~1 hour ahead of forecast`);
  console.log(`   So for "next 1 hour", it's OK to use slice(0, 12)`);
  console.log(`   BUT the documentation says it supports up to 7 days!`);
  console.log(`   With only 12 intervals = 1 hour max available, requests for 2+ hours are inaccurate`);
  
  console.log(`\n⚠️  IMPACT: If user requests "next 48 hours" of forecast prices,`);
  console.log(`   the system returns only ~1 hour of data without warning`);
  console.log(`   intervalsAvailable in the result shows this, but it's not obvious`);
}

// Bug #4: Edge case - requesting data near end of day
function testEdgeCaseNearMidnight() {
  console.log('\n\n=== BUG #4: Edge Case at 23:00 ===');
  const { hourly } = generateMockWeatherData();
  
  // Simulate being at 23:00
  const testHour = 23;
  console.log(`\nCurrent time: 23:00 UTC`);
  console.log(`Requesting: Next 6 hours of data`);
  
  // Find index for hour 23
  let startIdx = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    const t = new Date(hourly.time[i]);
    if (t.getHours() === testHour) {
      startIdx = i;
      break;
    }
  }
  
  const lookAheadHours = 6;
  const endIdx = Math.min(startIdx + lookAheadHours, hourly.shortwave_radiation.length);
  const radiationValues = hourly.shortwave_radiation.slice(startIdx, endIdx);
  
  console.log(`\n🔴 CURRENT LOGIC:`);
  console.log(`  - startIdx = ${startIdx} (hour 23:00)`);
  console.log(`  - endIdx = ${endIdx} (limited by array length)`);
  console.log(`  - Hours in slice: ${endIdx - startIdx} of requested 6`);
  console.log(`  - Got only ${radiationValues.length} hours of data!`);
  console.log(`  - No warning that we couldn't get full 6 hours`);
  
  console.log(`\n✅ SHOULD VALIDATE: Warn if we got fewer hours than requested`);
  console.log(`   Or at least log the discrepancy clearly`);
}

// Bug #5: Test time calculation formula
function testTimeCalculationFormula() {
  console.log('\n\n=== BUG #5: Incomplete Time Windows ===');
  
  console.log(`\nScenario: User asks for "next 48 hours"`);
  console.log(`  lookAheadUnit = 'hours'`);
  console.log(`  lookAhead = 48`);
  console.log(`  lookAheadHours = 48`);
  
  console.log(`\nCurrent weather API typically provides:`);
  console.log(`  - 48 hours of forecast data`);
  console.log(`  - Starting from the current hour (or next hour)`);
  
  console.log(`\nIf we include CURRENT hour (buggy):`);
  console.log(`  - slice(startIdx, startIdx + 48) might get hours [14, 15, 16, ...., 61]`);
  console.log(`  - But array only has 48 entries [0-47]`);
  console.log(`  - So we'd get hours [14, 15, ..., 47] = 34 hours (not 48!)`);
  
  console.log(`\nIf we fix to start from NEXT hour:`);
  console.log(`  - slice(startIdx+1, startIdx+1+48) gets hours [15, 16, ..., 62]`);
  console.log(`  - Again limited to [15, ..., 47] = 33 hours (still not 48)`);
  
  console.log(`\nROOT CAUSE: The code doesn't account for the fact that`);
  console.log(`  the current hour might be partially elapsed`);
  console.log(`  User expects full hours into the future, but may not get them`);
}

// Run all tests
console.log(`
╔════════════════════════════════════════════════════════════════╗
║     LOOKAHEAD TIME WINDOW BUGS - DETAILED ANALYSIS            ║
║                                                                ║
║ Testing: solarRadiation, cloudCover, forecastPrice conditions ║
╚════════════════════════════════════════════════════════════════╝
`);

testSolarRadiationBug();
testCloudCoverBug();
testForecastPriceBug();
testEdgeCaseNearMidnight();
testTimeCalculationFormula();

console.log(`
╔════════════════════════════════════════════════════════════════╗
║                         SUMMARY                               ║
╠════════════════════════════════════════════════════════════════╣
║ BUG 1: Solar Radiation includes CURRENT hour in lookahead     ║
║        Should start from NEXT hour                             ║
║                                                                ║
║ BUG 2: Cloud Cover includes CURRENT hour in lookahead         ║
║        Should start from NEXT hour (same fix as #1)            ║
║                                                                ║
║ BUG 3: Forecast Price limited by Amber API (~1 hour)          ║
║        Docs promise up to 7 days but only 1 hour available    ║
║        No warning when requested period exceeds available data ║
║                                                                ║
║ BUG 4: No validation that full timeframe was retrieved        ║
║        Edge cases (near midnight) silently return partial data ║
║                                                                ║
║ BUG 5: Current hour inclusion affects all calculations        ║
║        Users requesting "next 6 hours" get current + 5 future ║
║        This could cause rules to trigger at wrong times        ║
╠════════════════════════════════════════════════════════════════╣
║                   PRIORITY FIXES NEEDED                        ║
╠════════════════════════════════════════════════════════════════╣
║ 🔴 HIGH: Fix solar/cloud to start from NEXT hour (Bug #1, #2) ║
║🔴 HIGH: Add validation/warning for incomplete timeframes       ║
║🟡 MED:  Update forecast price docs or fix API limitation       ║
║🟡 MED:  Add logging for edge cases                              ║
╚════════════════════════════════════════════════════════════════╝
`);
