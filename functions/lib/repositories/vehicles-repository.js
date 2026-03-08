'use strict';

// ---------------------------------------------------------------------------
// Vehicles Repository
// ---------------------------------------------------------------------------
// Provides CRUD operations for the EV vehicle data model:
//   users/{uid}/vehicles/{vehicleId}          — vehicle registration + auth
//   users/{uid}/vehicles/{vehicleId}/state    — single doc, current status cache
//   users/{uid}/vehicles/{vehicleId}/commands/{commandId} — command audit log
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

  function commandsCollection(userId, vehicleId) {
    return vehicleRef(userId, vehicleId).collection('commands');
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
    await vehicleRef(userId, vehicleId).delete();
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

  // ---------------------------------------------------------------------------
  // Command audit log
  // ---------------------------------------------------------------------------

  /**
   * Append a command audit entry for idempotency tracking and observability.
   * @param {string} userId
   * @param {string} vehicleId
   * @param {object} commandEntry - {
   *   commandId, commandType, status, requestedAtIso, sentAtIso?,
   *   completedAtIso?, errorMsg?, params?
   * }
   * @returns {Promise<string>} Firestore document ID used as the audit key.
   */
  async function appendCommand(userId, vehicleId, commandEntry) {
    const { commandId } = commandEntry;
    if (!commandId) {
      throw new Error('appendCommand: commandId is required');
    }

    const ref = commandsCollection(userId, vehicleId).doc(String(commandId));
    await ref.set({
      ...commandEntry,
      loggedAt: serverTimestamp()
    });
    return String(commandId);
  }

  /**
   * Update the status of an existing command entry.
   * @param {string} userId
   * @param {string} vehicleId
   * @param {string} commandId
   * @param {object} patch - e.g. { status: 'confirmed', completedAtIso: '...' }
   * @returns {Promise<void>}
   */
  async function updateCommand(userId, vehicleId, commandId, patch) {
    await commandsCollection(userId, vehicleId).doc(String(commandId)).update({
      ...patch,
      updatedAt: serverTimestamp()
    });
  }

  /**
   * Retrieve a single command audit entry.
   * @param {string} userId
   * @param {string} vehicleId
   * @param {string} commandId
   * @returns {Promise<object|null>}
   */
  async function getCommand(userId, vehicleId, commandId) {
    const doc = await commandsCollection(userId, vehicleId).doc(String(commandId)).get();
    if (!doc.exists) return null;
    return doc.data();
  }

  /**
   * List recent commands for a vehicle (newest first), with optional limit.
   * @param {string} userId
   * @param {string} vehicleId
   * @param {object} [options] - { limit?: number }
   * @returns {Promise<object[]>}
   */
  async function listCommands(userId, vehicleId, options = {}) {
    const limit = typeof options.limit === 'number' ? options.limit : 50;
    const snapshot = await commandsCollection(userId, vehicleId)
      .orderBy('loggedAt', 'desc')
      .limit(limit)
      .get();
    const commands = [];
    snapshot.forEach((doc) => {
      if (doc.exists) commands.push({ commandId: doc.id, ...doc.data() });
    });
    return commands;
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
    getVehicleState,
    appendCommand,
    updateCommand,
    getCommand,
    listCommands
  };
}

module.exports = { createVehiclesRepository };
