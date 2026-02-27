/**
 * Amber Actual Prices Logic Tests
 * 
 * Unit tests for the timestamp validation and age calculation logic
 * used in the /api/amber/prices/actual endpoint
 */

describe('Amber Actual Prices Logic Tests', () => {
  /**
   * Calculate age of timestamp and determine if it's within valid window
   * Returns: { valid: boolean, reason: string|null, ageDays: number }
   */
  function validateTimestampAge(timestamp) {
    const targetTime = new Date(timestamp);
    const now = new Date();
    const ageMs = now.getTime() - targetTime.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const ageMinutes = ageMs / (1000 * 60);
    
    if (isNaN(targetTime.getTime())) {
      return { valid: false, reason: 'invalid_format', ageDays: null };
    }
    
    if (ageDays > 7) {
      return { valid: false, reason: 'outside_retention_window', ageDays };
    }
    
    if (ageMinutes < 5) {
      return { valid: false, reason: 'too_recent', ageDays, ageMinutes };
    }
    
    return { valid: true, reason: null, ageDays };
  }

  describe('Timestamp validation', () => {
    it('should accept timestamps within 1-7 days and > 5 minutes old', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const result = validateTimestampAge(twoDaysAgo);
      
      expect(result.valid).toBe(true);
      expect(result.reason).toBeNull();
      expect(result.ageDays).toBeGreaterThan(1);
      expect(result.ageDays).toBeLessThan(3);
    });

    it('should reject timestamps older than 7 days', () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const result = validateTimestampAge(eightDaysAgo);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('outside_retention_window');
      expect(result.ageDays).toBeGreaterThan(7);
    });

    it('should reject timestamps less than 5 minutes old', () => {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const result = validateTimestampAge(twoMinutesAgo);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('too_recent');
      expect(result.ageMinutes).toBeLessThan(5);
    });

    it('should reject invalid timestamp format', () => {
      const result = validateTimestampAge('not-a-date');
      
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_format');
    });

    it('should accept timestamp exactly 5 minutes old', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const result = validateTimestampAge(fiveMinutesAgo);
      
      expect(result.valid).toBe(true);
    });

    it('should accept timestamp just under 7 days old', () => {
      const justUnderSevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000 - 1000)).toISOString();
      const result = validateTimestampAge(justUnderSevenDaysAgo);
      
      expect(result.valid).toBe(true);
      expect(result.ageDays).toBeGreaterThan(6.99);
      expect(result.ageDays).toBeLessThanOrEqual(7);
    });
  });

  describe('Price interval matching', () => {
    /**
     * Find a price interval that contains the target timestamp
     */
    function findMatchingInterval(targetTimestamp, prices) {
      const targetTime = new Date(targetTimestamp);
      
      return prices.find(price => {
        const intervalStart = new Date(price.startTime);
        const intervalEnd = new Date(price.endTime);
        return targetTime >= intervalStart && targetTime <= intervalEnd;
      });
    }

    it('should find interval containing timestamp', () => {
      const targetTime = new Date('2025-12-21T10:15:00Z');
      const prices = [
        {
          startTime: '2025-12-21T10:00:00Z',
          endTime: '2025-12-21T10:30:00Z',
          perKwh: 25.5,
          channelType: 'general'
        },
        {
          startTime: '2025-12-21T10:30:00Z',
          endTime: '2025-12-21T11:00:00Z',
          perKwh: 28.0,
          channelType: 'general'
        }
      ];

      const match = findMatchingInterval(targetTime, prices);
      
      expect(match).toBeDefined();
      expect(match.perKwh).toBe(25.5);
      expect(match.startTime).toBe('2025-12-21T10:00:00Z');
    });

    it('should return undefined when no interval matches', () => {
      const targetTime = new Date('2025-12-21T12:00:00Z');
      const prices = [
        {
          startTime: '2025-12-21T10:00:00Z',
          endTime: '2025-12-21T10:30:00Z',
          perKwh: 25.5
        }
      ];

      const match = findMatchingInterval(targetTime, prices);
      
      expect(match).toBeUndefined();
    });

    it('should match timestamp at interval boundary', () => {
      const targetTime = new Date('2025-12-21T10:30:00Z');
      const prices = [
        {
          startTime: '2025-12-21T10:00:00Z',
          endTime: '2025-12-21T10:30:00Z',
          perKwh: 25.5
        }
      ];

      const match = findMatchingInterval(targetTime, prices);
      
      expect(match).toBeDefined();
      expect(match.perKwh).toBe(25.5);
    });
  });

  describe('Date extraction for API query', () => {
    function extractDate(timestamp) {
      return timestamp.split('T')[0]; // YYYY-MM-DD
    }

    it('should extract YYYY-MM-DD format from ISO timestamp', () => {
      const timestamp = '2025-12-21T10:15:30.123Z';
      const date = extractDate(timestamp);
      
      expect(date).toBe('2025-12-21');
    });

    it('should handle timestamps without milliseconds', () => {
      const timestamp = '2025-12-21T10:15:30Z';
      const date = extractDate(timestamp);
      
      expect(date).toBe('2025-12-21');
    });

    it('should handle timestamps with timezone offset', () => {
      const timestamp = '2025-12-21T10:15:30+11:00';
      const date = extractDate(timestamp);
      
      expect(date).toBe('2025-12-21');
    });
  });

  describe('Frontend integration logic', () => {
    /**
     * Simulates the frontend tryFetchActualPrices function logic
     */
    function shouldFetchActualPrices(eventStartTime) {
      if (!eventStartTime) return false;
      
      const eventTime = new Date(eventStartTime);
      const now = new Date();
      const ageMs = now.getTime() - eventTime.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const ageMinutes = ageMs / (1000 * 60);
      
      // Should fetch if within 7 days and older than 5 minutes
      return ageDays <= 7 && ageMinutes >= 5;
    }

    it('should fetch for event 2 hours ago', () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      expect(shouldFetchActualPrices(twoHoursAgo)).toBe(true);
    });

    it('should NOT fetch for event 8 days ago', () => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      expect(shouldFetchActualPrices(eightDaysAgo)).toBe(false);
    });

    it('should NOT fetch for event 2 minutes ago', () => {
      const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
      expect(shouldFetchActualPrices(twoMinutesAgo)).toBe(false);
    });

    it('should fetch for event exactly 1 day ago', () => {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      expect(shouldFetchActualPrices(oneDayAgo)).toBe(true);
    });
  });
});
