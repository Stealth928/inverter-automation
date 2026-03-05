'use strict';

const {
  findCurrentInterval,
  getCurrentAmberPrices
} = require('../lib/pricing-normalization');

describe('pricing normalization helpers', () => {
  test('findCurrentInterval returns null for invalid payloads', () => {
    expect(findCurrentInterval(null, 'feedIn')).toBeNull();
    expect(findCurrentInterval([], 'feedIn')).toBeNull();
  });

  test('findCurrentInterval matches current interval by channel', () => {
    const amberData = [
      { type: 'ForecastInterval', channelType: 'feedIn', perKwh: -8.2 },
      { type: 'CurrentInterval', channelType: 'general', perKwh: 31.1 },
      { type: 'CurrentInterval', channelType: 'feedIn', perKwh: -10.4 }
    ];

    expect(findCurrentInterval(amberData, 'feedIn')).toEqual({
      type: 'CurrentInterval',
      channelType: 'feedIn',
      perKwh: -10.4
    });
    expect(findCurrentInterval(amberData, 'general')).toEqual({
      type: 'CurrentInterval',
      channelType: 'general',
      perKwh: 31.1
    });
  });

  test('getCurrentAmberPrices returns null values when current intervals are absent', () => {
    const prices = getCurrentAmberPrices([
      { type: 'ForecastInterval', channelType: 'general', perKwh: 20.2 }
    ]);

    expect(prices).toEqual({
      feedInPrice: null,
      buyPrice: null
    });
  });

  test('getCurrentAmberPrices normalizes feed-in to positive cents and keeps buy price', () => {
    const prices = getCurrentAmberPrices([
      { type: 'CurrentInterval', channelType: 'feedIn', perKwh: -11.25 },
      { type: 'CurrentInterval', channelType: 'general', perKwh: 34.8 }
    ]);

    expect(prices).toEqual({
      feedInPrice: 11.25,
      buyPrice: 34.8
    });
  });
});
