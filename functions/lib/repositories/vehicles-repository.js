'use strict';

// ---------------------------------------------------------------------------
// Vehicles Repository
// ---------------------------------------------------------------------------
// Provides CRUD operations for the EV vehicle data model:
//   users/{uid}/vehicles/{vehicleId}          — vehicle registration + auth
//   users/{uid}/vehicles/{vehicleId}/state    — single doc, current status cache
// ---------------------------------------------------------------------------

function createVehiclesRepository(deps = {}) {
  const db = deps.db;
  const logger = deps.logger || { debug: () => {}, warn: () => {} };
  const serverTimestamp = deps.serverTimestamp || (() => new Date());

  if (!db || typeof db.collection !== 'function') {
    throw new Error('createVehiclesRepository requires a Firestore db dependency');
  }

  function userRef(userId) {
    return db.collection('users').doc(String(userId));
  }

  function vehiclesCollection(userId) {
    return userRef(userId).collection('vehicles');
  }

  function vehicleRef(userId, vehicleId) {
    return vehiclesCollection(userId).doc(String(vehicleId));
  }

  function vehicleStateRef(userId, vehicleId) {
    return vehicleRef(userId, vehicleId).collection('state').doc('current');
  }

  function describeDocRef(docRef) {
    return docRef?._path || docRef?.path || 'unknown';
  }

  async function deleteDocumentTreeFallback(docRef) {
    if (!docRef || typeof docRef.listCollections !== 'function') {
      try {
        await docRef?.delete?.();
      } catch (error) {
        logger.warn('VehiclesRepo', `deleteDocumentTreeFallback failed for ${describeDocRef(docRef)}: ${error && error.message ? error.message : error}`);
        throw error;
      }
      return;
    }

    const subcollections = await docRef.listCollections();
    for (const subcollection of subcollections) {
      let snapshot = await subcollection.limit(100).get();
      while (!snapshot.empty) {
        for (const doc of snapshot.docs) {
          await deleteDocumentTreeFallback(doc.ref);
        }
        snapshot = await subcollection.limit(100).get();
      }
    }

    try {
      await docRef.delete();
    } catch (error) {
      logger.warn('VehiclesRepo', `deleteDocumentTreeFallback failed for ${describeDocRef(docRef)}: ${error && error.message ? error.message : error}`);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Vehicle registration
  // ---------------------------------------------------------------------------

  /**
   * List all registered vehicles for a user.
   * @param {string} userId
   * @returns {Promise<object[]>} Array of vehicle objects.
   */
  async function listVehicles(userId) {
    const snapshot = await vehiclesCollection(userId).get();
    const vehicles = [];
    snapshot.forEach((doc) => {
      if (doc.exists) vehicles.push({ vehicleId: doc.id, ...doc.data() });
    });
    logger.debug('VehiclesRepo', `listVehicles: ${vehicles.length} vehicles for user ${userId}`);
    return vehicles;
  }

  /**
   * Retrieve a single vehicle registration by ID.
   * @param {string} userId
   * @param {string} vehicleId
   * @returns {Promise<object|null>}
   */
  async function getVehicle(userId, vehicleId) {
    const doc = await vehicleRef(userId, vehicleId).get();
    if (!doc.exists) return null;
    return { vehicleId: doc.id, ...doc.data() };
  }

  /**
   * Create or fully replace a vehicle registration document.
   * @param {string} userId
   * @param {string} vehicleId    - Canonical vehicle ID (e.g. provider:vin)
   * @param {object} registration - { provider, displayName, vin?, capabilities?, ... }
   * @returns {Promise<void>}
   */
  async function setVehicle(userId, vehicleId, registration) {
    await vehicleRef(userId, vehicleId).set({
      ...registration,
      updatedAt: serverTimestamp()
    });
    logger.debug('VehiclesRepo', `setVehicle: saved vehicle ${vehicleId} for user ${userId}`);
  }

  /**
   * Partially update a vehicle registration.
   * @param {string} userId
   * @param {string} vehicleId
   * @param {object} patch
   * @returns {Promise<void>}
   */
  async function updateVehicle(userId, vehicleId, patch) {
    await vehicleRef(userId, vehicleId).update({
      ...patch,
      updatedAt: serverTimestamp()
    });
  }

  /**
   * Delete a vehicle registration and its state+command subcollections.
   * NOTE: Firestore does not auto-delete subcollections; callers should use
   * a server-side recursive delete in production or the deleteVehicleDeep helper.
   * @param {string} userId
   * @param {string} vehicleId
   * @returns {Promise<void>}
   */
  async function deleteVehicle(userId, vehicleId) {
    const ref = vehicleRef(userId, vehicleId);
    if (typeof db.recursiveDelete === 'function') {
      await db.recursiveDelete(ref);
    } else {
      await deleteDocumentTreeFallback(ref);
    }
    logger.debug('VehiclesRepo', `deleteVehicle: removed vehicle ${vehicleId} for user ${userId}`);
  }

  // ---------------------------------------------------------------------------
  // Vehicle credentials (token storage)
  // ---------------------------------------------------------------------------

  /**
   * Store/replace OAuth credentials for a vehicle's provider.
   * Credentials are stored in a nested `credentials` field to isolate them
   * from registration metadata — never returned in list endpoints.
   * @param {string} userId
   * @param {string} vehicleId
   * @param {object} credentials - { accessToken, refreshToken, expiresAtMs, ... }
   * @returns {Promise<void>}
   */
  async function setVehicleCredentials(userId, vehicleId, credentials) {
    await vehicleRef(userId, vehicleId).update({
      credentials,
      credentialsUpdatedAt: serverTimestamp()
    });
  }

  /**
   * Retrieve stored credentials for a vehicle.
   * @param {string} userId
   * @param {string} vehicleId
   * @returns {Promise<object|null>}
   */
  async function getVehicleCredentials(userId, vehicleId) {
    const doc = await vehicleRef(userId, vehicleId).get();
    if (!doc.exists) return null;
    return doc.data().credentials || null;
  }

  // ---------------------------------------------------------------------------
  // Vehicle state cache
  // ---------------------------------------------------------------------------

  /**
   * Persist a normalised vehicle status snapshot.
   * @param {string} userId
   * @param {string} vehicleId
   * @param {object} status - Output of normalizeVehicleStatus()
   * @returns {Promise<void>}
   */
  async function saveVehicleState(userId, vehicleId, status) {
    await vehicleStateRef(userId, vehicleId).set({
      ...status,
      savedAt: serverTimestamp()
    });
  }

  /**
   * Read the most recent cached vehicle state.
   * @param {string} userId
   * @param {string} vehicleId
   * @returns {Promise<object|null>}
   */
  async function getVehicleState(userId, vehicleId) {
    const doc = await vehicleStateRef(userId, vehicleId).get();
    if (!doc.exists) return null;
    return doc.data();
  }

  return {
    listVehicles,
    getVehicle,
    setVehicle,
    updateVehicle,
    deleteVehicle,
    setVehicleCredentials,
    getVehicleCredentials,
    saveVehicleState,
    getVehicleState
  };
}

module.exports = { createVehiclesRepository };
