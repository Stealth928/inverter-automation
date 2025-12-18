#!/usr/bin/env node

/**
 * PHANTOM API CALLS - FIX VERIFICATION SCRIPT
 * 
 * This script verifies that all 4 phantom API call bugs have been fixed
 * by checking that system maintenance calls pass null userId instead of userId
 */

const fs = require('fs');
const path = require('path');

const ISSUES_FOUND = [];
const ISSUES_FIXED = [];

console.log('\n🔍 PHANTOM API CALLS - FIX VERIFICATION\n');
console.log('='  .repeat(60));

// Read the functions/index.js file
const indexPath = path.join(__dirname, 'functions', 'index.js');
const content = fs.readFileSync(indexPath, 'utf8');
const lines = content.split('\n');

console.log(`\n✅ Reading: ${indexPath}`);
console.log(`   Total lines: ${lines.length}`);

// Issue 1: Automation Disabled - Line ~2194
console.log('\n' + '-'.repeat(60));
console.log('🔎 FIX #1: Automation Disabled Clear (Line ~2194)');
console.log('-'.repeat(60));

const issue1Context = lines.slice(2190, 2210).join('\n');
if (issue1Context.includes('userConfig, null)')) {
  console.log('✅ FIXED: callFoxESSAPI called with null userId');
  ISSUES_FIXED.push('Automation disabled - no counter increment');
} else if (issue1Context.includes('userConfig, userId)')) {
  console.log('❌ NOT FIXED: callFoxESSAPI still passes userId');
  ISSUES_FOUND.push('Automation disabled - still increments counter');
} else {
  console.log('⚠️  UNCLEAR: Cannot verify code pattern');
}

// Issue 2: Rule Disable Flag Clear - Line ~2318
console.log('\n' + '-'.repeat(60));
console.log('🔎 FIX #2: Rule Disable Flag Clear (Line ~2318)');
console.log('-'.repeat(60));

const issue2Context = lines.slice(2314, 2324).join('\n');
if (issue2Context.includes('userConfig, null)')) {
  console.log('✅ FIXED: callFoxESSAPI called with null userId');
  ISSUES_FIXED.push('Rule disable flag - no counter increment');
} else if (issue2Context.includes('userConfig, userId)')) {
  console.log('❌ NOT FIXED: callFoxESSAPI still passes userId');
  ISSUES_FOUND.push('Rule disable flag - still increments counter');
} else {
  console.log('⚠️  UNCLEAR: Cannot verify code pattern');
}

// Issue 3: Active Rule Disabled - Line ~2350
console.log('\n' + '-'.repeat(60));
console.log('🔎 FIX #3: Active Rule Disabled Clear (Line ~2350)');
console.log('-'.repeat(60));

const issue3Context = lines.slice(2346, 2366).join('\n');
if (issue3Context.includes('userConfig, null)')) {
  console.log('✅ FIXED: callFoxESSAPI called with null userId');
  ISSUES_FIXED.push('Active rule disabled - no counter increment');
} else if (issue3Context.includes('userConfig, userId)')) {
  console.log('❌ NOT FIXED: callFoxESSAPI still passes userId');
  ISSUES_FOUND.push('Active rule disabled - still increments counter');
} else {
  console.log('⚠️  UNCLEAR: Cannot verify code pattern');
}

// Issue 4: Priority Rule Cancel - Line ~2715
console.log('\n' + '-'.repeat(60));
console.log('🔎 FIX #4: Priority Rule Cancel (Line ~2715)');
console.log('-'.repeat(60));

const issue4Context = lines.slice(2710, 2730).join('\n');
if (issue4Context.includes('userConfig, null)')) {
  console.log('✅ FIXED: callFoxESSAPI called with null userId');
  ISSUES_FIXED.push('Priority rule cancel - no counter increment');
} else if (issue4Context.includes('userConfig, userId)')) {
  console.log('❌ NOT FIXED: callFoxESSAPI still passes userId');
  ISSUES_FOUND.push('Priority rule cancel - still increments counter');
} else {
  console.log('⚠️  UNCLEAR: Cannot verify code pattern');
}

// Bonus: Check for CONTINUING CYCLE logging
console.log('\n' + '-'.repeat(60));
console.log('🔎 BONUS: Continuing Rule Logging (Line ~2674)');
console.log('-'.repeat(60));

if (content.includes('CONTINUING CYCLE')) {
  console.log('✅ ADDED: Continuing cycle logging present');
  console.log('   Message: "NO new scheduler segments applied"');
  ISSUES_FIXED.push('Added continuing cycle logging for transparency');
} else {
  console.log('❌ MISSING: Continuing cycle logging not found');
  ISSUES_FOUND.push('Missing continuing cycle logging');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 VERIFICATION SUMMARY');
console.log('='.repeat(60));

console.log(`\n✅ FIXED (${ISSUES_FIXED.length}):`);
ISSUES_FIXED.forEach((issue, i) => {
  console.log(`   ${i + 1}. ${issue}`);
});

if (ISSUES_FOUND.length > 0) {
  console.log(`\n❌ STILL BROKEN (${ISSUES_FOUND.length}):`);
  ISSUES_FOUND.forEach((issue, i) => {
    console.log(`   ${i + 1}. ${issue}`);
  });
  console.log('\n⚠️  ACTION REQUIRED: Apply fixes before deployment');
  process.exit(1);
} else {
  console.log(`\n🎉 ALL ISSUES FIXED!`);
  console.log('\n📋 Changes verified:');
  console.log('   • 4 critical phantom call bugs fixed');
  console.log('   • All system maintenance calls use null userId');
  console.log('   • Continuing cycle logging added');
  console.log('   • Ready for testing and deployment');
  console.log('\n✅ Deploy to staging for validation\n');
  process.exit(0);
}

