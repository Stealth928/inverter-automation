'use strict';

const CURRENT_INTERVAL_TYPE = 'CurrentInterval';
const FEED_IN_CHANNEL = 'feedIn';
const GENERAL_CHANNEL = 'general';

function findCurrentInterval(amberData, channelType) {
  if (!Array.isArray(amberData) || amberData.length === 0) {
    return null;
  }

  return amberData.find(
    (interval) => interval && interval.type === CURRENT_INTERVAL_TYPE && interval.channelType === channelType
  ) || null;
}

function getCurrentAmberPrices(amberData) {
  let feedInPrice = null;
  let buyPrice = null;

  if (Array.isArray(amberData)) {
    const feedInInterval = findCurrentInterval(amberData, FEED_IN_CHANNEL);
    const generalInterval = findCurrentInterval(amberData, GENERAL_CHANNEL);

    if (feedInInterval) {
      // Amber feed-in values are negative; invert to represent export earnings in positive cents/kWh.
      feedInPrice = -feedInInterval.perKwh;
    }
    if (generalInterval) {
      buyPrice = generalInterval.perKwh;
    }
  }

  return { feedInPrice, buyPrice };
}

module.exports = {
  CURRENT_INTERVAL_TYPE,
  FEED_IN_CHANNEL,
  GENERAL_CHANNEL,
  findCurrentInterval,
  getCurrentAmberPrices
};
