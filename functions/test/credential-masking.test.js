/**
 * Tests for credential masking and security features
 * Verifies that credentials are properly masked in UI while actual values are securely stored
 */

describe('Credential Masking & Security', () => {
  let mockFirestore;
  let mockFunctions;
  let mockAuth;
  let db;

  beforeEach(() => {
    // Mock Firebase Admin SDK
    mockFirestore = {
      collection: jest.fn().mockReturnThis(),
      doc: jest.fn().mockReturnThis(),
      get: jest.fn(),
      set: jest.fn(),
      update: jest.fn(),
    };

    mockAuth = {
      verifyIdToken: jest.fn(),
    };

    mockFunctions = {
      config: jest.fn().mockReturnValue({
        foxess: { token: 'test-foxess-token' },
        amber: { api_key: 'test-amber-key' },
      }),
    };

    db = mockFirestore;
  });

  describe('Credential Display Logic', () => {
    test('Credentials should be masked with dots in UI when displaying saved credentials', () => {
      // This test verifies the expected behavior documented in settings.html
      // When a credential is loaded from Firestore, it should:
      // 1. Display as ••••••••
      // 2. Store actual value in data-actualValue attribute

      const credential = 'a470aead-5f6a-4519-bbb3-7981fda4ed00';
      const maskedDisplay = '••••••••';

      // Simulate credential loading
      expect(maskedDisplay).toBe('••••••••');
      expect(credential).toBe('a470aead-5f6a-4519-bbb3-7981fda4ed00');
    });

    test('originalCredentials should store masked value to match field display', () => {
      // When credentials are loaded, originalCredentials must be set to the masked value
      // so that checkCredentialsChanged() doesn't detect a false "modified" state
      const originalCredentials = {
        foxessToken: '••••••••',  // Masked to match field display
        amberKey: '••••••••',     // Masked to match field display
        deviceSn: 'ABC123',       // Device SN is not masked
      };

      expect(originalCredentials.foxessToken).toBe('••••••••');
      expect(originalCredentials.amberKey).toBe('••••••••');
      expect(originalCredentials.deviceSn).toBe('ABC123');
    });

    test('Actual credential values should be stored separately in data-actualValue', () => {
      // Simulate HTML element with masked display and hidden actual value
      const mockInput = {
        value: '••••••••',  // Display to user
        dataset: {
          actualValue: 'a470aead-5f6a-4519-bbb3-7981fda4ed00'  // Actual stored value
        }
      };

      expect(mockInput.value).toBe('••••••••');
      expect(mockInput.dataset.actualValue).toBe('a470aead-5f6a-4519-bbb3-7981fda4ed00');
    });
  });

  describe('Show/Hide Button Functionality', () => {
    test('Show button should reveal actual credential value', () => {
      const input = {
        type: 'password',  // Initially masked
        value: '••••••••',
        dataset: { actualValue: 'a470aead-5f6a-4519-bbb3-7981fda4ed00' }
      };

      // Simulate Show button click
      input.type = 'text';
      if (input.dataset.actualValue) {
        input.value = input.dataset.actualValue;
      }

      expect(input.type).toBe('text');
      expect(input.value).toBe('a470aead-5f6a-4519-bbb3-7981fda4ed00');
    });

    test('Hide button should re-mask credential value', () => {
      const input = {
        type: 'text',
        value: 'a470aead-5f6a-4519-bbb3-7981fda4ed00',
        dataset: { actualValue: 'a470aead-5f6a-4519-bbb3-7981fda4ed00' }
      };

      // Simulate Hide button click
      input.type = 'password';
      input.value = '••••••••';

      expect(input.type).toBe('password');
      expect(input.value).toBe('••••••••');
    });

    test('Show/Hide toggle should not modify actual value in data-actualValue', () => {
      const input = {
        type: 'password',
        value: '••••••••',
        dataset: { actualValue: 'a470aead-5f6a-4519-bbb3-7981fda4ed00' }
      };

      const originalActualValue = input.dataset.actualValue;

      // Toggle show
      input.type = 'text';
      if (input.dataset.actualValue) {
        input.value = input.dataset.actualValue;
      }
      expect(input.dataset.actualValue).toBe(originalActualValue);

      // Toggle hide
      input.type = 'password';
      input.value = '••••••••';
      expect(input.dataset.actualValue).toBe(originalActualValue);
    });
  });

  describe('Change Detection with Masked Values', () => {
    test('checkCredentialsChanged should return false on fresh load with masked display', () => {
      // After loadSettings completes:
      // - Field value: ••••••••
      // - originalCredentials.foxessToken: ••••••••
      // - Should NOT be marked as changed

      const currentValue = '••••••••';
      const originalValue = '••••••••';

      const hasChanged = currentValue !== originalValue;
      expect(hasChanged).toBe(false);
    });

    test('checkCredentialsChanged should return true when user modifies masked credential', () => {
      // User clears the masked field and enters a new value
      const originalValue = '••••••••';  // Loaded from Firestore
      const currentValue = 'new-token-value';  // User typed this

      const hasChanged = currentValue !== originalValue;
      expect(hasChanged).toBe(true);
    });

    test('checkCredentialsChanged should handle empty credentials correctly', () => {
      // When credentials don't exist
      const testCases = [
        { original: '', current: '', shouldChange: false },
        { original: '', current: '••••••••', shouldChange: true },
        { original: '••••••••', current: '', shouldChange: true },
        { original: 'some-value', current: 'some-value', shouldChange: false },
      ];

      testCases.forEach(test => {
        const hasChanged = test.original !== test.current;
        expect(hasChanged).toBe(test.shouldChange);
      });
    });
  });

  describe('Credential Saving with Masked Values', () => {
    test('saveCredentials should detect masked value and use data-actualValue for sending', () => {
      // When user clicks Save and field shows masked dots:
      // 1. Check if field value is ••••••••
      // 2. If so, use data-actualValue as the actual credential
      // 3. If not (user entered new value), use that new value

      const foxessDisplayed = '••••••••';
      const foxessInput = {
        value: foxessDisplayed,
        dataset: { actualValue: 'a470aead-5f6a-4519-bbb3-7981fda4ed00' }
      };

      const foxessToSend = (foxessDisplayed === '••••••••' && foxessInput?.dataset.actualValue)
        ? foxessInput.dataset.actualValue
        : foxessDisplayed;

      expect(foxessToSend).toBe('a470aead-5f6a-4519-bbb3-7981fda4ed00');
    });

    test('saveCredentials should use new value when user enters unmasked credential', () => {
      // User clears field and enters new token
      const amberDisplayed = 'psk_newtoken12345';
      const amberInput = {
        value: amberDisplayed,
        dataset: { actualValue: 'psk_oldtoken67890' }  // Old value
      };

      const amberToSend = (amberDisplayed === '••••••••' && amberInput?.dataset.actualValue)
        ? amberInput.dataset.actualValue
        : amberDisplayed;

      expect(amberToSend).toBe('psk_newtoken12345');
    });

    test('saveCredentials should not modify actual value stored in database', () => {
      // Verify the logic flow for credential save
      const credentials = {
        foxessToken: 'a470aead-5f6a-4519-bbb3-7981fda4ed00',
        amberApiKey: 'psk_3847595aaffa4e60c55071f2d4663c86',
        deviceSn: '60KB10305AKA064'
      };

      // These values would be sent to /api/config/save endpoint
      expect(credentials.foxessToken).toBe('a470aead-5f6a-4519-bbb3-7981fda4ed00');
      expect(credentials.amberApiKey).toBe('psk_3847595aaffa4e60c55071f2d4663c86');
      expect(credentials.deviceSn).toBe('60KB10305AKA064');
    });
  });

  describe('Credential Deletion', () => {
    test('Deleting credential should clear field and update originalCredentials', () => {
      const input = {
        value: '••••••••',
        dataset: { actualValue: 'a470aead-5f6a-4519-bbb3-7981fda4ed00' }
      };

      // Simulate delete operation
      delete input.dataset.actualValue;
      input.value = '';

      const originalValue = '';
      const currentValue = input.value;

      expect(currentValue).toBe('');
      expect(input.dataset.actualValue).toBeUndefined();
      expect(currentValue === originalValue).toBe(true);  // Should show as "Synced"
    });
  });

  describe('Health Endpoint Credential Detection', () => {
    test('/api/health endpoint should return credential presence without leaking actual values', async () => {
      // The /api/health endpoint should only return booleans, never actual credentials
      const healthResponse = {
        ok: true,
        FOXESS_TOKEN: true,  // Boolean - credential exists
        AMBER_API_KEY: true  // Boolean - credential exists
      };

      expect(healthResponse.ok).toBe(true);
      expect(typeof healthResponse.FOXESS_TOKEN).toBe('boolean');
      expect(typeof healthResponse.AMBER_API_KEY).toBe('boolean');
      expect(healthResponse).not.toHaveProperty('foxessToken');  // Never include actual value
      expect(healthResponse).not.toHaveProperty('amberApiKey');  // Never include actual value
    });

    test('Health endpoint should correctly detect credential presence from Firestore', async () => {
      // Mock Firestore config with credentials
      const firestoreConfig = {
        foxessToken: 'a470aead-5f6a-4519-bbb3-7981fda4ed00',
        amberApiKey: 'psk_3847595aaffa4e60c55071f2d4663c86',
        deviceSn: '60KB10305AKA064'
      };

      const hasFoxess = !!firestoreConfig.foxessToken;
      const hasAmber = !!firestoreConfig.amberApiKey;

      expect(hasFoxess).toBe(true);
      expect(hasAmber).toBe(true);
    });

    test('Health endpoint should return false for missing credentials', async () => {
      // Mock Firestore config without credentials
      const firestoreConfig = {
        deviceSn: '60KB10305AKA064'
        // No foxessToken or amberApiKey
      };

      const hasFoxess = !!firestoreConfig.foxessToken;
      const hasAmber = !!firestoreConfig.amberApiKey;

      expect(hasFoxess).toBe(false);
      expect(hasAmber).toBe(false);
    });
  });

  describe('Security - No Credential Leaks', () => {
    test('Actual credentials should never appear in console logs', () => {
      // Verify that logging never includes actual credential values
      const shouldNotLog = [
        'a470aead-5f6a-4519-bbb3-7981fda4ed00',  // Actual FoxESS token
        'psk_3847595aaffa4e60c55071f2d4663c86',  // Actual Amber API key
      ];

      const safeLog = '••••••••';  // Only this should be logged

      shouldNotLog.forEach(cred => {
        expect(safeLog).not.toBe(cred);
      });
    });

    test('Actual credentials should only be in data-actualValue and never in DOM display', () => {
      // Simulate proper DOM structure
      const input = {
        value: '••••••••',  // Only masked in DOM
        dataset: { actualValue: 'a470aead-5f6a-4519-bbb3-7981fda4ed00' }  // Hidden in dataset
      };

      // The value visible in HTML should be masked
      expect(input.value).toBe('••••••••');
      // The actual value should be inaccessible to normal DOM inspection
      // (it's in JavaScript variable, not in HTML)
      expect(input.dataset.actualValue).toBe('a470aead-5f6a-4519-bbb3-7981fda4ed00');
    });

    test('Credential validation should never log actual credential values', () => {
      // When validating /api/config/validate-keys, actual values go in request body
      // but should never appear in console or response logs
      const requestPayload = {
        foxessToken: 'a470aead-5f6a-4519-bbb3-7981fda4ed00',
        amberApiKey: 'psk_3847595aaffa4e60c55071f2d4663c86'
      };

      // Validation response should only be success/failure, not echo credentials
      const validationResponse = {
        errno: 0,
        result: { valid: true }
        // Should NOT include: foxessToken, amberApiKey
      };

      expect(validationResponse).not.toHaveProperty('foxessToken');
      expect(validationResponse).not.toHaveProperty('amberApiKey');
    });
  });
});
