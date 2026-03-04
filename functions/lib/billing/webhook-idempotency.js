'use strict';

function normalizeKeyPart(value, fallback) {
  const raw = value === undefined || value === null ? '' : String(value);
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  return normalized || fallback;
}

function buildWebhookEventKey(provider, eventId) {
  const providerPart = normalizeKeyPart(provider, 'unknown_provider');
  const eventPart = normalizeKeyPart(eventId, 'missing_event');
  return `${providerPart}__${eventPart}`;
}

function buildBillingEventRecord(normalizedEvent, options = {}) {
  if (!normalizedEvent || typeof normalizedEvent !== 'object') {
    throw new Error('normalizedEvent must be an object');
  }

  const receivedAtMs = Number.isFinite(Number(options.receivedAtMs))
    ? Math.floor(Number(options.receivedAtMs))
    : Date.now();

  const occurredAtMs = Number.isFinite(Number(normalizedEvent.occurredAtMs))
    ? Math.floor(Number(normalizedEvent.occurredAtMs))
    : receivedAtMs;

  return {
    key: buildWebhookEventKey(normalizedEvent.provider, normalizedEvent.eventId),
    provider: normalizedEvent.provider || 'unknown',
    eventId: normalizedEvent.eventId || 'missing_event',
    eventType: normalizedEvent.eventType || 'unknown',
    occurredAtMs,
    receivedAtMs,
    processingStatus: options.processingStatus || 'processed',
    attemptCount: Number.isFinite(Number(options.attemptCount))
      ? Math.max(1, Math.floor(Number(options.attemptCount)))
      : 1,
    lastError: options.lastError || null
  };
}

function shouldProcessEvent(existingRecord, incomingRecord) {
  if (!existingRecord) {
    return true;
  }

  if (!incomingRecord) {
    return false;
  }

  const existingOccurredAtMs = Number(existingRecord.occurredAtMs || 0);
  const incomingOccurredAtMs = Number(incomingRecord.occurredAtMs || 0);

  if (incomingOccurredAtMs > existingOccurredAtMs) {
    return true;
  }

  if (incomingOccurredAtMs < existingOccurredAtMs) {
    return false;
  }

  // Same event timestamp: only process if previous attempt failed and we are retrying.
  return existingRecord.processingStatus !== 'processed';
}

function mergeEventRecords(existingRecord, incomingRecord) {
  if (!existingRecord) {
    return incomingRecord;
  }

  if (!incomingRecord) {
    return existingRecord;
  }

  const processIncoming = shouldProcessEvent(existingRecord, incomingRecord);
  if (!processIncoming) {
    return {
      ...existingRecord,
      attemptCount: Math.max(Number(existingRecord.attemptCount || 1), Number(incomingRecord.attemptCount || 1))
    };
  }

  return {
    ...existingRecord,
    ...incomingRecord,
    attemptCount: Math.max(Number(existingRecord.attemptCount || 1), Number(incomingRecord.attemptCount || 1)),
    previousStatus: existingRecord.processingStatus || null
  };
}

module.exports = {
  buildBillingEventRecord,
  buildWebhookEventKey,
  mergeEventRecords,
  shouldProcessEvent
};
