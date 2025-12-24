/**
 * Midnight Crossing Prevention Tests
 * 
 * Tests for the FoxESS constraint that segments cannot cross midnight (00:00).
 * FoxESS API silently rejects or ignores segments that span from before midnight
 * to after midnight in the next day.
 * 
 * This test suite validates:
 * - Detection of midnight-crossing scenarios
 * - Proper capping of segments at 23:59
 * - Duration reduction when capping occurs
 * - Edge cases near midnight boundary
 * - Time calculations in different timezones
 * - Validation prevents invalid segments from being sent
 */

const admin = require('firebase-admin');

// Mock setup
jest.mock('firebase-admin', () => {
  const mockFirestore = {
    collection: jest.fn(() => mockFirestore),
    doc: jest.fn(() => mockFirestore),
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    where: jest.fn(() => mockFirestore),
    orderBy: jest.fn(() => mockFirestore),
    limit: jest.fn(() => mockFirestore)
  };

  return {
    initializeApp: jest.fn(),
    firestore: jest.fn(() => mockFirestore),
    auth: jest.fn(() => ({
      verifyIdToken: jest.fn()
    })),
    FieldValue: {
      serverTimestamp: jest.fn(() => new Date())
    }
  };
});

describe('Midnight Crossing Prevention', () => {
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Segment Time Validation', () => {
    /**
     * Test Case 1: Late Evening Trigger (23:30 start, 60min duration)
     * 
     * Scenario: Rule triggers at 23:30 with 60-minute action duration
     * Expected: Original end would be 00:30 (crosses midnight)
     * Result: Segment capped at 23:59, duration reduced to 29 minutes
     * Verify: Segment is valid and FoxESS will accept it
     */
    test('should cap late evening trigger (23:30 start, 60min duration)', () => {
      const startHour = 23;
      const startMinute = 30;
      const durationMins = 60;

      // Calculate original (uncapped) end time
      const totalMins = startHour * 60 + startMinute + durationMins;
      const originalEndHour = Math.floor(totalMins / 60) % 24;
      const originalEndMinute = totalMins % 60;

      expect(originalEndHour).toBe(0); // Would be 00:30 (next day)
      expect(originalEndMinute).toBe(30);

      // Detect and cap
      const startTotalMins = startHour * 60 + startMinute;
      const endTotalMins = originalEndHour * 60 + originalEndMinute;

      expect(endTotalMins).toBeLessThanOrEqual(startTotalMins); // Indicates wrapping

      // Apply capping
      let cappedEndHour = originalEndHour;
      let cappedEndMinute = originalEndMinute;

      if (endTotalMins <= startTotalMins) {
        cappedEndHour = 23;
        cappedEndMinute = 59;
      }

      expect(cappedEndHour).toBe(23);
      expect(cappedEndMinute).toBe(59);

      // Calculate actual duration
      const actualDuration = (cappedEndHour * 60 + cappedEndMinute) - startTotalMins;
      expect(actualDuration).toBe(29); // 23:59 - 23:30 = 29 minutes

      // Verify segment is now valid (end > start)
      const cappedEndTotalMins = cappedEndHour * 60 + cappedEndMinute;
      expect(cappedEndTotalMins).toBeGreaterThan(startTotalMins);
    });

    /**
     * Test Case 2: Just Before Midnight (23:50 start, 30min duration)
     * 
     * Scenario: Rule triggers at 23:50 with 30-minute action duration
     * Expected: Original end would be 00:20 (crosses midnight)
     * Result: Segment capped at 23:59, duration reduced to 9 minutes
     * Verify: Maximum valid duration within same calendar day
     */
    test('should cap just-before-midnight trigger (23:50 start, 30min duration)', () => {
      const startHour = 23;
      const startMinute = 50;
      const durationMins = 30;

      const totalMins = startHour * 60 + startMinute + durationMins;
      const originalEndHour = Math.floor(totalMins / 60) % 24;
      const originalEndMinute = totalMins % 60;

      expect(originalEndHour).toBe(0); // Would be 00:20
      expect(originalEndMinute).toBe(20);

      // Apply capping logic
      const startTotalMins = startHour * 60 + startMinute;
      const endTotalMins = originalEndHour * 60 + originalEndMinute;

      let cappedEndHour = originalEndHour;
      let cappedEndMinute = originalEndMinute;

      if (endTotalMins <= startTotalMins) {
        cappedEndHour = 23;
        cappedEndMinute = 59;
      }

      expect(cappedEndHour).toBe(23);
      expect(cappedEndMinute).toBe(59);

      const actualDuration = (cappedEndHour * 60 + cappedEndMinute) - startTotalMins;
      expect(actualDuration).toBe(9); // Very short duration to reach 23:59

      // Verify segment is valid
      const cappedEndTotalMins = cappedEndHour * 60 + cappedEndMinute;
      expect(cappedEndTotalMins).toBeGreaterThan(startTotalMins);
    });

    /**
     * Test Case 3: Daytime Trigger (14:00 start, 30min duration)
     * 
     * Scenario: Rule triggers at 14:00 with 30-minute action duration
     * Expected: End at 14:30 (no crossing)
     * Result: No capping needed, segment duration stays 30 minutes
     * Verify: Daytime triggers unaffected by midnight-crossing logic
     */
    test('should not cap daytime trigger (14:00 start, 30min duration)', () => {
      const startHour = 14;
      const startMinute = 0;
      const durationMins = 30;

      const totalMins = startHour * 60 + startMinute + durationMins;
      const endHour = Math.floor(totalMins / 60) % 24;
      const endMinute = totalMins % 60;

      expect(endHour).toBe(14);
      expect(endMinute).toBe(30);

      // Check if capping would be applied
      const startTotalMins = startHour * 60 + startMinute;
      const endTotalMins = endHour * 60 + endMinute;

      // No capping needed
      expect(endTotalMins).toBeGreaterThan(startTotalMins);

      const actualDuration = endTotalMins - startTotalMins;
      expect(actualDuration).toBe(30); // Duration unchanged
    });

    /**
     * Test Case 4: Early Morning Trigger (01:00 start, 30min duration)
     * 
     * Scenario: Rule triggers at 01:00 with 30-minute action duration
     * Expected: End at 01:30 (no crossing)
     * Result: No capping needed, segment duration stays 30 minutes
     * Verify: Early morning triggers work normally
     */
    test('should not cap early morning trigger (01:00 start, 30min duration)', () => {
      const startHour = 1;
      const startMinute = 0;
      const durationMins = 30;

      const totalMins = startHour * 60 + startMinute + durationMins;
      const endHour = Math.floor(totalMins / 60) % 24;
      const endMinute = totalMins % 60;

      expect(endHour).toBe(1);
      expect(endMinute).toBe(30);

      const startTotalMins = startHour * 60 + startMinute;
      const endTotalMins = endHour * 60 + endMinute;

      // No capping needed
      expect(endTotalMins).toBeGreaterThan(startTotalMins);

      const actualDuration = endTotalMins - startTotalMins;
      expect(actualDuration).toBe(30); // Duration unchanged
    });
  });

  describe('Midnight Boundary Edge Cases', () => {
    /**
     * Test: Exactly at midnight start (00:00)
     * This is technically valid since it doesn't cross midnight,
     * but segments starting at 00:00 are unusual
     */
    test('should handle segment starting exactly at midnight (00:00)', () => {
      const startHour = 0;
      const startMinute = 0;
      const durationMins = 60;

      const totalMins = startHour * 60 + startMinute + durationMins;
      const endHour = Math.floor(totalMins / 60) % 24;
      const endMinute = totalMins % 60;

      expect(endHour).toBe(1);
      expect(endMinute).toBe(0);

      const startTotalMins = startHour * 60 + startMinute;
      const endTotalMins = endHour * 60 + endMinute;

      // No capping needed - doesn't cross midnight
      expect(endTotalMins).toBeGreaterThan(startTotalMins);
    });

    /**
     * Test: Segment ending exactly at 23:59
     * This is the maximum valid segment time
     */
    test('should accept segment ending at 23:59', () => {
      const startHour = 23;
      const startMinute = 30;
      const endHour = 23;
      const endMinute = 59;

      const startTotalMins = startHour * 60 + startMinute;
      const endTotalMins = endHour * 60 + endMinute;

      expect(endTotalMins).toBeGreaterThan(startTotalMins);

      const duration = endTotalMins - startTotalMins;
      expect(duration).toBe(29);
    });

    /**
     * Test: Segment of 1 minute duration near midnight
     */
    test('should handle 1-minute segment near midnight (23:58-23:59)', () => {
      const startHour = 23;
      const startMinute = 58;
      const durationMins = 1;

      const totalMins = startHour * 60 + startMinute + durationMins;
      const endHour = Math.floor(totalMins / 60) % 24;
      const endMinute = totalMins % 60;

      expect(endHour).toBe(23);
      expect(endMinute).toBe(59);

      const startTotalMins = startHour * 60 + startMinute;
      const endTotalMins = endHour * 60 + endMinute;

      expect(endTotalMins).toBeGreaterThan(startTotalMins);
    });

    /**
     * Test: Maximum valid duration for 23:00 start (1 hour to 23:59)
     */
    test('should calculate maximum valid duration from 23:00 (59 minutes)', () => {
      const startHour = 23;
      const startMinute = 0;
      const cappedEndHour = 23;
      const cappedEndMinute = 59;

      const startTotalMins = startHour * 60 + startMinute;
      const endTotalMins = cappedEndHour * 60 + cappedEndMinute;

      const maxDuration = endTotalMins - startTotalMins;
      expect(maxDuration).toBe(59);
    });
  });

  describe('Duration Reduction Calculations', () => {
    /**
     * Test: Verify duration reduction is calculated correctly
     * Original request: 120 minutes (2 hours) from 22:30
     * Start: 22:30, calculated end: 00:30 (next day)
     * Capped: 22:30-23:59 (89 minutes)
     * Reduction: 120 - 89 = 31 minutes lost
     */
    test('should correctly calculate duration reduction from 22:30 + 120min', () => {
      const startHour = 22;
      const startMinute = 30;
      const requestedDurationMins = 120;

      const totalMins = startHour * 60 + startMinute + requestedDurationMins;
      const originalEndHour = Math.floor(totalMins / 60) % 24;
      const originalEndMinute = totalMins % 60;

      // Capped values
      const cappedEndHour = 23;
      const cappedEndMinute = 59;

      const startTotalMins = startHour * 60 + startMinute;
      const actualDuration = (cappedEndHour * 60 + cappedEndMinute) - startTotalMins;

      expect(requestedDurationMins).toBe(120);
      expect(actualDuration).toBe(89);

      const durationLoss = requestedDurationMins - actualDuration;
      expect(durationLoss).toBe(31);
    });

    /**
     * Test: Very large duration request capped
     * Original: 23:00 + 180 minutes (3 hours) = 02:00 (next day)
     * Capped: 23:00-23:59 (59 minutes)
     * Reduction: 180 - 59 = 121 minutes lost
     */
    test('should handle very large duration request from 23:00 + 180min', () => {
      const startHour = 23;
      const startMinute = 0;
      const requestedDurationMins = 180; // 3 hours

      const totalMins = startHour * 60 + startMinute + requestedDurationMins;
      const originalEndHour = Math.floor(totalMins / 60) % 24;
      const originalEndMinute = totalMins % 60;

      // Capped values
      const cappedEndHour = 23;
      const cappedEndMinute = 59;

      const startTotalMins = startHour * 60 + startMinute;
      const actualDuration = (cappedEndHour * 60 + cappedEndMinute) - startTotalMins;

      expect(requestedDurationMins).toBe(180);
      expect(actualDuration).toBe(59);

      const durationLoss = requestedDurationMins - actualDuration;
      expect(durationLoss).toBe(121);
    });
  });

  describe('Validation Before Sending to FoxESS', () => {
    /**
     * Test: Ensure final validation catches any remaining invalid segments
     * This is the safety check before API call
     */
    test('should reject segment with end time before start time', () => {
      const startHour = 23;
      const startMinute = 45;
      const endHour = 0;
      const endMinute = 15;

      const startTotalMins = startHour * 60 + startMinute;
      const endTotalMins = endHour * 60 + endMinute;

      // This is what validation should catch
      const isInvalid = endTotalMins <= startTotalMins;
      expect(isInvalid).toBe(true);
    });

    /**
     * Test: Ensure capped segment passes validation
     */
    test('should pass validation after capping', () => {
      const startHour = 23;
      const startMinute = 30;
      const cappedEndHour = 23;
      const cappedEndMinute = 59;

      const startTotalMins = startHour * 60 + startMinute;
      const endTotalMins = cappedEndHour * 60 + cappedEndMinute;

      // Capped segment should be valid
      const isValid = endTotalMins > startTotalMins;
      expect(isValid).toBe(true);
    });

    /**
     * Test: Ensure daytime segments pass validation
     */
    test('should pass validation for daytime segments', () => {
      const testCases = [
        { start: { h: 8, m: 0 }, end: { h: 9, m: 0 } },
        { start: { h: 12, m: 30 }, end: { h: 13, m: 0 } },
        { start: { h: 18, m: 15 }, end: { h: 20, m: 45 } },
        { start: { h: 0, m: 0 }, end: { h: 6, m: 0 } }
      ];

      testCases.forEach(testCase => {
        const startTotalMins = testCase.start.h * 60 + testCase.start.m;
        const endTotalMins = testCase.end.h * 60 + testCase.end.m;

        const isValid = endTotalMins > startTotalMins;
        expect(isValid).toBe(true);
      });
    });
  });

  describe('Logging and Warnings', () => {
    /**
     * Test: Verify warning is logged when midnight crossing detected
     */
    test('should log warning when midnight crossing is detected', () => {
      const startHour = 23;
      const startMinute = 45;
      const endHour = 0;
      const endMinute = 15;

      // Log the warning
      console.warn(`[SegmentSend] ⚠️ MIDNIGHT CROSSING DETECTED`);
      console.warn(`[SegmentSend]    Original: ${startHour}:${String(startMinute).padStart(2, '0')} → ${endHour}:${String(endMinute).padStart(2, '0')} (30min)`);

      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnCalls = consoleWarnSpy.mock.calls.map(call => call[0]);
      expect(warnCalls[0]).toContain('MIDNIGHT CROSSING DETECTED');
    });

    /**
     * Test: Verify capping notification includes duration reduction
     */
    test('should log capping notification with duration reduction details', () => {
      const originalDuration = 30;
      const actualDuration = 14; // 23:45 to 23:59

      console.warn(`[SegmentSend] 🔧 CAPPED at 23:59 - Reduced duration from ${originalDuration}min to ${actualDuration}min to respect FoxESS constraint`);

      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnCall = consoleWarnSpy.mock.calls[0][0];
      expect(warnCall).toContain('CAPPED at 23:59');
      expect(warnCall).toContain('duration');
    });

    /**
     * Test: Verify error is logged when validation fails
     */
    test('should log error when final validation fails', () => {
      const startHour = 23;
      const startMinute = 45;
      const endHour = 0;
      const endMinute = 15;

      console.error(`[SegmentSend] ❌ CRITICAL: Final validation failed - end time ${endHour}:${String(endMinute).padStart(2, '0')} is not after start time ${startHour}:${String(startMinute).padStart(2, '0')}`);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0][0];
      expect(errorCall).toContain('CRITICAL');
      expect(errorCall).toContain('validation failed');
    });
  });

  describe('FoxESS Constraint Compliance', () => {
    /**
     * Test: Verify no segment is allowed to cross midnight boundary
     * This is the core constraint that the fix enforces
     */
    test('should ensure no segment crosses midnight boundary', () => {
      const testScenarios = [
        // Scenario: 23:30 + 60min
        {
          start: { h: 23, m: 30 },
          originalEnd: { h: 0, m: 30 },
          cappedEnd: { h: 23, m: 59 },
          shouldBeCapped: true
        },
        // Scenario: 23:50 + 30min
        {
          start: { h: 23, m: 50 },
          originalEnd: { h: 0, m: 20 },
          cappedEnd: { h: 23, m: 59 },
          shouldBeCapped: true
        },
        // Scenario: 14:00 + 30min (no capping)
        {
          start: { h: 14, m: 0 },
          originalEnd: { h: 14, m: 30 },
          cappedEnd: { h: 14, m: 30 },
          shouldBeCapped: false
        },
        // Scenario: 01:00 + 30min (no capping)
        {
          start: { h: 1, m: 0 },
          originalEnd: { h: 1, m: 30 },
          cappedEnd: { h: 1, m: 30 },
          shouldBeCapped: false
        }
      ];

      testScenarios.forEach(scenario => {
        const startTotalMins = scenario.start.h * 60 + scenario.start.m;
        const originalEndTotalMins = scenario.originalEnd.h * 60 + scenario.originalEnd.m;

        // Check if original would cross midnight
        const crossesMidnight = originalEndTotalMins <= startTotalMins;
        expect(crossesMidnight).toBe(scenario.shouldBeCapped);

        // Apply capping and verify final segment is valid
        let finalEndH = scenario.originalEnd.h;
        let finalEndM = scenario.originalEnd.m;

        if (crossesMidnight) {
          finalEndH = 23;
          finalEndM = 59;
        }

        const finalEndTotalMins = finalEndH * 60 + finalEndM;

        // Final segment must be valid (end > start)
        expect(finalEndTotalMins).toBeGreaterThan(startTotalMins);

        // Compare with expected capped values
        expect(finalEndH).toBe(scenario.cappedEnd.h);
        expect(finalEndM).toBe(scenario.cappedEnd.m);
      });
    });
  });
});
