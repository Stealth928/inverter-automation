# Ready-to-Implement Code Fixes

## 1. Add Environment-Based Logging Control

**File:** `functions/index.js` (top of file, after imports, around line 50)

```javascript
// ==================== LOGGING CONFIGURATION ====================
// Control logging verbosity via environment variables
const DEBUG = process.env.DEBUG === 'true';
const VERBOSE = process.env.VERBOSE === 'true';
const VERBOSE_API = process.env.VERBOSE_API === 'true';

// Logger utility function
const logger = {
  error: (tag, message) => {
    console.error(`[${tag}] ${message}`);
  },
  warn: (tag, message) => {
    console.warn(`[${tag}] ${message}`);
  },
  info: (tag, message, onlyIfVerbose = false) => {
    if (!onlyIfVerbose || VERBOSE) {
      console.log(`[${tag}] ${message}`);
    }
  },
  debug: (tag, message) => {
    if (DEBUG) {
      console.log(`[${tag}] [DEBUG] ${message}`);
    }
  }
};
```

---

## 2. Fix API Request Logging (Line 208)

**Before:**
```javascript
app.use((req, res, next) => {
  try {
    console.log('[API REQ] ', req.method, req.originalUrl || req.url, 'headers:', Object.keys(req.headers).slice(0,10));
  } catch (e) { /* ignore logging errors */ }
  next();
});
```

**After:**
```javascript
app.use((req, res, next) => {
  try {
    if (VERBOSE_API) {
      logger.debug('API', `${req.method} ${req.path}`);
    }
  } catch (e) { /* ignore logging errors */ }
  next();
});
```

**Impact:** Reduces 1,000+ logs/hour to 0 (unless VERBOSE_API=true)

---

## 3. Fix Auth Logging (Lines 252-270)

**Before:**
```javascript
const tryAttachUser = async (req) => {
  if (req.user) {
    console.log('[Auth] User already attached:', req.user.uid);  // REMOVE
    return;
  }
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[Auth] No Authorization header or not Bearer format');  // REMOVE
    return;
  }
  
  console.log('[Auth] Attempting to verify token:', idToken.substring(0, 20) + '...');  // REMOVE
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    console.log('[Auth] Token verified successfully for user:', decodedToken.uid);  // REMOVE
    req.user = decodedToken;
  } catch (error) {
    console.warn('[Auth] Token verification failed:', error.message);  // KEEP
  }
};
```

**After:**
```javascript
const tryAttachUser = async (req) => {
  if (req.user) {
    return;
  }
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return;
  }
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
  } catch (error) {
    logger.warn('Auth', `Token verification failed: ${error.message}`);
  }
};
```

**Impact:** Reduces 300-500 logs/hour to single error logs only

---

## 4. Fix Cache Logging (Lines 829-864)

**Before:**
```javascript
// REMOVE: Line 829
console.log(`[Cache] No sites cache found for ${userId}`);

// REMOVE: Lines 838-842
console.log(`[Cache] Sites cache expired for ${userId} (age: ${Math.round(cacheAge / 1000)}s)`);
console.log(`[Cache] Using cached sites for ${userId} (age: ${Math.round(cacheAge / 1000)}s)`);

// REMOVE: Line 862
console.log(`[Cache] Stored ${sites.length} sites in cache for ${userId}`);
```

**After:**
```javascript
// Only log errors, not hits/misses:
if (error) {
  logger.error('Cache', `Error reading sites cache for ${userId}: ${error.message}`);
}

if (storeError) {
  logger.error('Cache', `Error storing sites cache for ${userId}: ${storeError.message}`);
}
```

**Impact:** Reduces 200+ logs/hour to 0 (unless errors occur)

---

## 5. Fix Amber API Logging (Lines 539-568)

**Before:**
```javascript
console.log(`[Amber /prices/current] Another request is fetching prices for ${userId}, waiting...`);
console.log(`[Amber /prices/current] Cache miss for user ${userId}, calling API`);
console.log(`[Amber /prices/current] Received ${result.length} total intervals`);
```

**After:**
```javascript
// Remove these entirely - cache hit/miss is expected behavior
// Only log if something unusual happens:

if (!result || result.length === 0) {
  logger.warn('Amber', `No price data received for ${userId}`);
}
```

**Impact:** Reduces 120+ logs/hour to 0 (unless errors)

---

## 6. Fix Validation Logging (Lines 313-435)

**Before:**
```javascript
console.log(`[Validation] Testing FoxESS token`);
console.log(`[Validation] FoxESS API response:`, foxResult);  // Full response dump!
console.log(`[Setup Status] Request headers:`, {...});        // Headers dump!
console.log(`[Setup Status] getUserConfig result for...:`);   // Config dump!
```

**After:**
```javascript
logger.info('Validation', `FoxESS credentials validated for ${userId}`);
// Remove response dumps entirely - log only success/failure

if (foxResult.errno !== 0) {
  logger.error('Validation', `FoxESS validation failed: ${foxResult.error}`);
}
```

**Impact:** Reduces 50+ lines per setup to 1-2 concise lines

---

## 7. Environment Variables to Add

**File:** `.env` (create if doesn't exist) and `functions/.env.local`

```bash
# Logging Control
DEBUG=false              # Set to true for detailed debug logs
VERBOSE=false            # Set to true for verbose operation logs
VERBOSE_API=false        # Set to true for API request logging
```

**For Cloud Deployment:**
Add to `firebase.json`:
```json
{
  "functions": {
    "env": [
      "DEBUG=false",
      "VERBOSE=false",
      "VERBOSE_API=false"
    ]
  }
}
```

---

## 8. Update Tests to Verify Logging Changes

Add to existing test suite (or new file `functions/test/logging.test.js`):

```javascript
describe('Logging Configuration', () => {
  test('verbose logs should respect VERBOSE flag', () => {
    const originalDebug = process.env.VERBOSE;
    
    process.env.VERBOSE = 'false';
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    
    logger.info('Test', 'This should not appear', true);
    expect(logSpy).not.toHaveBeenCalled();
    
    logSpy.mockRestore();
    process.env.VERBOSE = originalDebug;
  });

  test('error logs should always appear', () => {
    const logSpy = jest.spyOn(console, 'error').mockImplementation();
    
    logger.error('Test', 'This should appear');
    expect(logSpy).toHaveBeenCalled();
    
    logSpy.mockRestore();
  });
});
```

---

## 9. Deploy & Verify

```bash
# Deploy with debugging disabled (production)
firebase deploy --only functions

# Deploy with verbose logging (staging)
firebase deploy --only functions --env VERBOSE=true

# Test locally with debug logs
DEBUG=true VERBOSE=true npm --prefix functions run serve
```

---

## 10. Monitor Impact

Before/After Comparison:

| Metric | Before | After | Impact |
|--------|--------|-------|--------|
| **Lines/Hour** | ~2,000 | ~100 | ✅ 95% reduction |
| **Searchability** | Hard | Easy | ✅ Can find real issues |
| **Security** | Headers logged | Not logged | ✅ Fixed |
| **Noise** | High | Low | ✅ Better visibility |
| **Debug capability** | Off | Controllable | ✅ Flexible |

---

## Implementation Checklist

- [ ] Add logger utility (Section 1)
- [ ] Fix API request logging (Section 2)
- [ ] Fix auth logging (Section 3)
- [ ] Fix cache logging (Section 4)
- [ ] Fix Amber API logging (Section 5)
- [ ] Fix validation logging (Section 6)
- [ ] Create .env file (Section 7)
- [ ] Add tests (Section 8)
- [ ] Run full test suite
- [ ] Deploy to staging
- [ ] Monitor for 1 hour
- [ ] Deploy to production
- [ ] Update documentation

**Total Time:** 1-2 hours  
**Risk Level:** Low (only removes debug logs, keeps error logs)  
**Rollback:** Simple (revert to previous version if needed)
