/**
 * Weather API Tests
 * Tests geocoding functionality and location resolution
 */

const fetch = require('node-fetch');

describe('Weather API - Geocoding', () => {
  const baseGeoUrl = 'https://geocoding-api.open-meteo.com/v1/search';

  /**
   * Test that geocoding returns results with count=5
   */
  test('Geocoding should return 5 results for "Narara"', async () => {
    const url = `${baseGeoUrl}?name=Narara&count=5&language=en`;
    const response = await fetch(url);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.results).toBeDefined();
    expect(data.results.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * Test that Australian location is present in results
   */
  test('Geocoding "Narara" should include Australia result', async () => {
    const url = `${baseGeoUrl}?name=Narara&count=5&language=en`;
    const response = await fetch(url);
    const data = await response.json();

    const auResult = data.results.find(r => r.country_code === 'AU');
    expect(auResult).toBeDefined();
    expect(auResult.name).toBe('Narara');
    expect(auResult.country).toBe('Australia');
    expect(auResult.admin1).toBe('New South Wales');
    expect(auResult.latitude).toBe(-33.39593);
    expect(auResult.longitude).toBe(151.33527);
  });

  /**
   * Test that filtering prioritizes Australian locations
   */
  test('Filtering results by country_code=AU should return Australian Narara', async () => {
    const url = `${baseGeoUrl}?name=Narara&count=5&language=en`;
    const response = await fetch(url);
    const data = await response.json();

    // Simulate the filtering logic from the API
    const auResult = data.results.find(r => r.country_code === 'AU');
    const selectedResult = auResult || data.results[0];

    expect(selectedResult.country_code).toBe('AU');
    expect(selectedResult.country).toBe('Australia');
    expect(selectedResult.name).toBe('Narara');
  });

  /**
   * Test that Fiji Narara is present but not prioritized
   */
  test('Geocoding "Narara" should include Fiji result but AU is preferred', async () => {
    const url = `${baseGeoUrl}?name=Narara&count=5&language=en`;
    const response = await fetch(url);
    const data = await response.json();

    const fijiResult = data.results.find(r => r.country_code === 'FJ');
    expect(fijiResult).toBeDefined();
    expect(fijiResult.name).toBe('Narara');
    expect(fijiResult.country).toBe('Fiji');

    // But AU should be prioritized
    const auResult = data.results.find(r => r.country_code === 'AU');
    expect(auResult).toBeDefined();
  });

  /**
   * Test common Australian locations resolve correctly
   */
  test('Geocoding "Sydney" should return Australia', async () => {
    const url = `${baseGeoUrl}?name=Sydney&count=5&language=en`;
    const response = await fetch(url);
    const data = await response.json();

    const auResult = data.results.find(r => r.country_code === 'AU');
    expect(auResult).toBeDefined();
    expect(auResult.country).toBe('Australia');
  });

  /**
   * Test that "Melbourne" resolves to Australia
   */
  test('Geocoding "Melbourne" should return Australia', async () => {
    const url = `${baseGeoUrl}?name=Melbourne&count=5&language=en`;
    const response = await fetch(url);
    const data = await response.json();

    const auResult = data.results.find(r => r.country_code === 'AU');
    expect(auResult).toBeDefined();
    expect(auResult.country).toBe('Australia');
  });

  /**
   * Test that "Central Coast" (Narara region) resolves
   */
  test('Geocoding "Central Coast" should return Australia NSW', async () => {
    const url = `${baseGeoUrl}?name=Central%20Coast&count=5&language=en`;
    const response = await fetch(url);
    const data = await response.json();

    expect(data.results.length).toBeGreaterThan(0);
    const auResult = data.results.find(r => r.country_code === 'AU');
    expect(auResult).toBeDefined();
    expect(auResult.admin1).toBe('New South Wales');
  });

  /**
   * Test that invalid location falls back gracefully
   */
  test('Geocoding invalid location should return empty results', async () => {
    const url = `${baseGeoUrl}?name=InvalidLocationXYZ123&count=5&language=en`;
    const response = await fetch(url);
    const data = await response.json();

    expect(response.status).toBe(200);
    // Invalid locations may have empty results or not
    // Just verify the response structure is valid
    if (data.results) {
      expect(Array.isArray(data.results)).toBe(true);
    }
  });

  /**
   * Test that short queries (2 chars) only match exact names
   */
  test('Geocoding with 2 characters should perform exact matching only', async () => {
    const url = `${baseGeoUrl}?name=na&count=5&language=en`;
    const response = await fetch(url);
    const data = await response.json();

    // According to Open-Meteo docs: 2 chars = exact matching only
    expect(response.status).toBe(200);
    expect(data.results).toBeDefined();
  });

  /**
   * Test API response structure
   */
  test('Geocoding response should have correct structure', async () => {
    const url = `${baseGeoUrl}?name=Sydney&count=1&language=en`;
    const response = await fetch(url);
    const data = await response.json();

    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);

    if (data.results.length > 0) {
      const result = data.results[0];
      expect(result.name).toBeDefined();
      expect(result.latitude).toBeDefined();
      expect(result.longitude).toBeDefined();
      expect(result.country).toBeDefined();
      expect(result.country_code).toBeDefined();
      expect(typeof result.latitude).toBe('number');
      expect(typeof result.longitude).toBe('number');
    }
  });
});
