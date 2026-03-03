/**
 * Rule Library — Static template data
 *
 * Each entry follows the live rule schema (conditions + action) with
 * enabled: false pre-set so imports land as inactive. Users review and
 * activate from Settings after import.
 *
 * IMPORTANT: All minSocOnGrid values must be >= 20.
 * NOTE: ForceCharge templates intentionally use fdPwr: 0 placeholders.
 * The Rules Library import flow resolves these to non-zero, user-safe values
 * derived from each user's inverter capacity/default power settings.
 *
 * Categories:
 *   price       — 💰 Price Optimisation
 *   battery     — 🔋 Battery Protection
 *   solar       — ☀️ Solar Forecasting
 *   time        — 🕐 Time Scheduling
 *   seasonal    — 🌦️ Seasonal & Weather
 *   ev          — 🚗 EV-Friendly
 */

window.RULE_LIBRARY = [

  // ─────────────────────────────────────────────
  // 💰 PRICE OPTIMISATION
  // ─────────────────────────────────────────────
  {
    id: 'price_high_feedin_export',
    name: 'High Feed-in Export',
    category: 'price',
    categoryLabel: '💰 Price Optimisation',
    difficulty: 'Beginner',
    description: 'Forces the inverter to discharge the battery to the grid when feed-in prices are exceptionally high — turning your stored energy into cash.',
    whyUseIt: 'Great for volatile electricity markets (like Amber) where feed-in prices spike above 30¢. Captures peak export revenue that passive self-use mode would miss.',
    conditionSummary: ['Feed-in price ≥ 30¢/kWh', 'Battery SoC ≥ 40%'],
    rule: {
      enabled: false,
      priority: 2,
      cooldownMinutes: 15,
      conditions: {
        feedInPrice: { enabled: true, operator: '>=', value: 30, value2: null },
        buyPrice:    { enabled: false },
        soc:         { enabled: true,  operator: '>=', value: 40, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'ForceDischarge',
        durationMinutes: 30,
        fdPwr: 5000,
        fdSoc: 20,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  },

  {
    id: 'price_cheap_import_charge',
    name: 'Cheap Import Charging',
    category: 'price',
    categoryLabel: '💰 Price Optimisation',
    difficulty: 'Beginner',
    description: 'Charges the battery from the grid when electricity is cheap so it reaches your configured SoC target before higher-price periods.',
    whyUseIt: 'Great for overnight cheap-rate tariffs or negative-price events. Minimises the cost of energy stored in the battery.',
    conditionSummary: ['Buy price ≤ 5¢/kWh', 'Battery SoC ≤ 70%'],
    rule: {
      enabled: false,
      priority: 3,
      cooldownMinutes: 30,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: true, operator: '<=', value: 5, value2: null },
        soc:         { enabled: true, operator: '<=', value: 70, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'ForceCharge',
        durationMinutes: 60,
        fdPwr: 0,
        fdSoc: 100,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  },

  {
    id: 'price_negative_price_charge',
    name: 'Negative Price Charge',
    category: 'price',
    categoryLabel: '💰 Price Optimisation',
    difficulty: 'Intermediate',
    description: 'Charges the battery when grid prices go negative — you are paid to consume electricity while building stored energy for later use.',
    whyUseIt: 'Great for dynamic markets like Amber where negative prices occur during high renewable generation. Captures negative-price windows without relying on overly aggressive charge settings.',
    conditionSummary: ['Buy price ≤ -3¢/kWh (negative)', 'Battery SoC ≤ 90%'],
    rule: {
      enabled: false,
      priority: 1,
      cooldownMinutes: 10,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: true, operator: '<=', value: -3, value2: null },
        soc:         { enabled: true, operator: '<=', value: 90, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'ForceCharge',
        durationMinutes: 60,
        fdPwr: 0,
        fdSoc: 100,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  },

  {
    id: 'price_spike_response',
    name: 'Price Spike Response',
    category: 'price',
    categoryLabel: '💰 Price Optimisation',
    difficulty: 'Intermediate',
    description: 'Exports stored energy during a grid price spike while keeping a minimum battery reserve, maximising the value of each kWh exported.',
    whyUseIt: 'Great for short dispatch windows (15–30 min) during peak demand events. Balances export revenue with ensuring enough charge for evening use.',
    conditionSummary: ['Feed-in price ≥ 50¢/kWh', 'Battery SoC ≥ 50%'],
    rule: {
      enabled: false,
      priority: 1,
      cooldownMinutes: 20,
      conditions: {
        feedInPrice: { enabled: true, operator: '>=', value: 50, value2: null },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '>=', value: 50, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'ForceDischarge',
        durationMinutes: 20,
        fdPwr: 8000,
        fdSoc: 25,
        minSocOnGrid: 25,
        maxSoc: 100
      }
    }
  },

  {
    id: 'price_forecast_precharge',
    name: 'Pre-charge Before Expensive Period',
    category: 'price',
    categoryLabel: '💰 Price Optimisation',
    difficulty: 'Advanced',
    description: 'Pre-charges the battery when current prices are low and forecasted prices in the next 2 hours are significantly higher — buying cheap before the peak.',
    whyUseIt: 'Great for households with predictable morning and evening peak windows. Avoids drawing from the grid at peak rates.',
    conditionSummary: ['Buy price ≤ 10¢/kWh now', 'Forecast avg price > 25¢ next 2h', 'Battery SoC ≤ 60%'],
    rule: {
      enabled: false,
      priority: 4,
      cooldownMinutes: 60,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: true, operator: '<=', value: 10, value2: null },
        soc:         { enabled: true, operator: '<=', value: 60, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: true, type: 'general', checkType: 'average', operator: '>=', value: 25, lookAhead: 2, lookAheadUnit: 'hours' },
        time:           { enabled: false }
      },
      action: {
        workMode: 'ForceCharge',
        durationMinutes: 60,
        fdPwr: 0,
        fdSoc: 85,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  },

  {
    id: 'price_midday_solar_export',
    name: 'Midday Solar Export Boost',
    category: 'price',
    categoryLabel: '💰 Price Optimisation',
    difficulty: 'Intermediate',
    description: 'During strong solar hours, if feed-in prices are moderate and the battery is filling up, discharges to grid at a controlled rate to capture export value before the battery hits full and curtails.',
    whyUseIt: 'Great for oversized solar systems that regularly curtail during midday. Keeps the battery in its optimal cycling range while earning revenue.',
    conditionSummary: ['Feed-in price ≥ 10¢/kWh', 'Battery SoC between 60–95%', 'Time: 10:00 – 15:00'],
    rule: {
      enabled: false,
      priority: 6,
      cooldownMinutes: 30,
      conditions: {
        feedInPrice: { enabled: true, operator: '>=', value: 10, value2: null },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: 'between', value: 60, value2: 95 },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: true, startTime: '10:00', endTime: '15:00' }
      },
      action: {
        workMode: 'ForceDischarge',
        durationMinutes: 30,
        fdPwr: 2500,
        fdSoc: 40,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  },

  {
    id: 'price_buy_price_guard',
    name: 'Expensive Grid Guard',
    category: 'price',
    categoryLabel: '💰 Price Optimisation',
    difficulty: 'Beginner',
    description: 'Switches to self-use and raises the minimum SoC floor when grid buy prices are high, preventing the inverter from importing expensive power for household loads.',
    whyUseIt: 'Great as a general safety rule for all Amber users. When prices are high you want to run on battery — not the grid. This rule ensures the system switches to self-consumption when it matters most.',
    conditionSummary: ['Buy price ≥ 30¢/kWh', 'Battery SoC ≥ 20%'],
    rule: {
      enabled: false,
      priority: 3,
      cooldownMinutes: 15,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: true, operator: '>=', value: 30, value2: null },
        soc:         { enabled: true, operator: '>=', value: 20, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'SelfUse',
        durationMinutes: 30,
        fdPwr: 0,
        fdSoc: 0,
        minSocOnGrid: 30,
        maxSoc: 100
      }
    }
  },

  // ─────────────────────────────────────────────
  // 🔋 BATTERY PROTECTION
  // ─────────────────────────────────────────────
  {
    id: 'battery_low_soc_guard',
    name: 'Low SoC Emergency Guard',
    category: 'battery',
    categoryLabel: '🔋 Battery Protection',
    difficulty: 'Beginner',
    description: 'Switches the inverter to self-use mode with a raised minimum SoC floor when battery charge drops critically low, preventing deep discharge and preserving battery health.',
    whyUseIt: 'Great as a safety net for all setups. Deep discharge cycles shorten battery lifespan significantly — this rule acts as a last-resort floor.',
    conditionSummary: ['Battery SoC ≤ 15%'],
    rule: {
      enabled: false,
      priority: 1,
      cooldownMinutes: 60,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '<=', value: 15, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'SelfUse',
        durationMinutes: 120,
        fdPwr: 0,
        fdSoc: 0,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  },

  {
    id: 'battery_high_temp_limit',
    name: 'High Battery Temperature Limiter',
    category: 'battery',
    categoryLabel: '🔋 Battery Protection',
    difficulty: 'Intermediate',
    description: 'Reduces inverter activity to self-use (minimal charge/discharge cycling) when the battery temperature is too high, protecting battery chemistry.',
    whyUseIt: 'Great for summer months or poorly ventilated battery installations. High temperatures accelerate battery degradation and can be a safety hazard.',
    conditionSummary: ['Battery temperature ≥ 40°C'],
    rule: {
      enabled: false,
      priority: 1,
      cooldownMinutes: 30,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: false },
        soc:         { enabled: false },
        temperature: { enabled: true, type: 'battery', operator: '>=', value: 40 },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'SelfUse',
        durationMinutes: 60,
        fdPwr: 0,
        fdSoc: 0,
        minSocOnGrid: 20,
        maxSoc: 80
      }
    }
  },

  {
    id: 'battery_conservative_max_soc',
    name: 'Conservative Max SoC (Battery Longevity)',
    category: 'battery',
    categoryLabel: '🔋 Battery Protection',
    difficulty: 'Beginner',
    description: 'Sets the battery maximum SoC to 90% during regular self-use, reducing stress on cells and extending overall battery lifespan.',
    whyUseIt: 'Great for households not relying on full battery capacity daily. Keeping lithium cells below 95% consistently can significantly extend pack life.',
    conditionSummary: ['Always active (SoC ≥ 0%)', 'Caps charging at 90%'],
    rule: {
      enabled: false,
      priority: 10,
      cooldownMinutes: 1440,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '>=', value: 0, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'SelfUse',
        durationMinutes: 1440,
        fdPwr: 0,
        fdSoc: 0,
        minSocOnGrid: 20,
        maxSoc: 90
      }
    }
  },

  {
    id: 'battery_overnight_soc_floor',
    name: 'Overnight SoC Floor',
    category: 'battery',
    categoryLabel: '🔋 Battery Protection',
    difficulty: 'Beginner',
    description: 'Prevents the battery from draining below 30% overnight when no solar is available to recharge, ensuring a morning reserve for loads or outages.',
    whyUseIt: 'Great for households running heavy overnight loads (hot water, HVAC). Guarantees a usable morning buffer and avoids deep cycling during off-solar hours.',
    conditionSummary: ['Time: 20:00 – 06:00', 'Battery SoC ≤ 35%'],
    rule: {
      enabled: false,
      priority: 5,
      cooldownMinutes: 120,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '<=', value: 35, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: true, startTime: '20:00', endTime: '06:00' }
      },
      action: {
        workMode: 'SelfUse',
        durationMinutes: 180,
        fdPwr: 0,
        fdSoc: 0,
        minSocOnGrid: 30,
        maxSoc: 100
      }
    }
  },

  // ─────────────────────────────────────────────
  // ☀️ SOLAR FORECASTING
  // ─────────────────────────────────────────────
  {
    id: 'solar_cloudy_precharge',
    name: 'Cloudy Day Pre-charge',
    category: 'solar',
    categoryLabel: '☀️ Solar Forecasting',
    difficulty: 'Intermediate',
    description: 'Pre-charges the battery overnight when the next day\'s solar forecast shows heavy cloud cover, ensuring you start the day with useful reserve.',
    whyUseIt: 'Great for days when solar generation will be insufficient to fill the battery. Prevents arriving at peak demand with an empty battery.',
    conditionSummary: ['Cloud cover avg > 80% next 6h', 'Buy price ≤ 15¢/kWh', 'Battery SoC ≤ 50%'],
    rule: {
      enabled: false,
      priority: 4,
      cooldownMinutes: 120,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: true, operator: '<=', value: 15, value2: null },
        soc:         { enabled: true, operator: '<=', value: 50, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: true, checkType: 'average', operator: '>=', value: 80, lookAhead: 6, lookAheadUnit: 'hours' },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'ForceCharge',
        durationMinutes: 90,
        fdPwr: 0,
        fdSoc: 80,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  },

  {
    id: 'solar_sunny_peak_headroom',
    name: 'Sunny Peak — Create Headroom',
    category: 'solar',
    categoryLabel: '☀️ Solar Forecasting',
    difficulty: 'Intermediate',
    description: 'Discharges a partially-full battery to grid when strong solar generation is forecast, making room to capture more free solar energy instead of curtailing.',
    whyUseIt: 'Great for systems with solar curtailment issues or limited grid export headroom. Maximises solar self-consumption by ensuring the battery isn\'t already full when generation peaks.',
    conditionSummary: ['Solar radiation avg > 600 W/m² next 3h', 'Battery SoC ≥ 80%', 'Feed-in price ≥ 5¢/kWh'],
    rule: {
      enabled: false,
      priority: 5,
      cooldownMinutes: 60,
      conditions: {
        feedInPrice: { enabled: true, operator: '>=', value: 5, value2: null },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '>=', value: 80, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: true, checkType: 'average', operator: '>=', value: 600, lookAhead: 3, lookAheadUnit: 'hours' },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'ForceDischarge',
        durationMinutes: 30,
        fdPwr: 3000,
        fdSoc: 50,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  },

  {
    id: 'solar_low_generation_backup',
    name: 'Low Solar Generation — Hold Reserve',
    category: 'solar',
    categoryLabel: '☀️ Solar Forecasting',
    difficulty: 'Advanced',
    description: 'When solar radiation forecast is weak for the next 6 hours and buy price is moderate, switches to self-use mode with a raised SoC floor to conserve battery for evening peak rather than depleting it on daytime loads.',
    whyUseIt: 'Great for cloudy autumn/winter days where solar won\'t meaningfully recharge the battery. Prevents running into the evening peak with an empty battery and having to buy expensive grid power.',
    conditionSummary: ['Solar radiation avg < 200 W/m² next 6h', 'Buy price between 10–30¢', 'Battery SoC between 25–60%'],
    rule: {
      enabled: false,
      priority: 6,
      cooldownMinutes: 120,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: true, operator: 'between', value: 10, value2: 30 },
        soc:         { enabled: true, operator: 'between', value: 25, value2: 60 },
        temperature: { enabled: false },
        solarRadiation: { enabled: true, checkType: 'average', operator: '<=', value: 200, lookAhead: 6, lookAheadUnit: 'hours' },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'SelfUse',
        durationMinutes: 120,
        fdPwr: 0,
        fdSoc: 0,
        minSocOnGrid: 25,
        maxSoc: 100
      }
    }
  },

  // ─────────────────────────────────────────────
  // 🕐 TIME SCHEDULING
  // ─────────────────────────────────────────────
  {
    id: 'time_offpeak_overnight_charge',
    name: 'Off-Peak Overnight Charge',
    category: 'time',
    categoryLabel: '🕐 Time Scheduling',
    difficulty: 'Beginner',
    description: 'Charges the battery during a fixed overnight off-peak window (1am–5am), using controlled charging power during cheaper tariff periods.',
    whyUseIt: 'Great for households on a fixed two-rate tariff (e.g. Economy 7 / Controlled Load). Fills the battery cheaply every night without relying on price signals.',
    conditionSummary: ['Time: 01:00 – 05:00', 'Battery SoC ≤ 80%'],
    rule: {
      enabled: false,
      priority: 5,
      cooldownMinutes: 240,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '<=', value: 80, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: true, startTime: '01:00', endTime: '05:00' }
      },
      action: {
        workMode: 'ForceCharge',
        durationMinutes: 240,
        fdPwr: 0,
        fdSoc: 90,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  },

  {
    id: 'time_peak_demand_shield',
    name: 'Peak Demand Shield',
    category: 'time',
    categoryLabel: '🕐 Time Scheduling',
    difficulty: 'Beginner',
    description: 'Switches the inverter into self-use with a protected SoC reserve during evening peak demand windows, avoiding grid draw at the most expensive times.',
    whyUseIt: 'Great for network tariff households or those on time-of-use rates. Ensures the battery is available during the highest-demand period of the day.',
    conditionSummary: ['Time: 17:00 – 21:00', 'Battery SoC ≥ 30%'],
    rule: {
      enabled: false,
      priority: 3,
      cooldownMinutes: 60,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '>=', value: 30, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: true, startTime: '17:00', endTime: '21:00' }
      },
      action: {
        workMode: 'SelfUse',
        durationMinutes: 240,
        fdPwr: 0,
        fdSoc: 0,
        minSocOnGrid: 30,
        maxSoc: 100
      }
    }
  },

  {
    id: 'time_morning_peak_charge',
    name: 'Morning Pre-Peak Top-Up',
    category: 'time',
    categoryLabel: '🕐 Time Scheduling',
    difficulty: 'Intermediate',
    description: 'Tops up the battery before the morning peak demand window (6am–9am) if it drained overnight, using shoulder rates just before solar generation kicks in.',
    whyUseIt: 'Great for households with high morning loads (breakfast, heating, school/work prep) and time-of-use tariffs that spike at 7am. Fills the gap before solar takes over.',
    conditionSummary: ['Time: 05:00 – 06:30', 'Battery SoC ≤ 40%'],
    rule: {
      enabled: false,
      priority: 5,
      cooldownMinutes: 120,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '<=', value: 40, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: true, startTime: '05:00', endTime: '06:30' }
      },
      action: {
        workMode: 'ForceCharge',
        durationMinutes: 90,
        fdPwr: 0,
        fdSoc: 60,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  },

  {
    id: 'time_shoulder_export',
    name: 'Shoulder Rate Export',
    category: 'time',
    categoryLabel: '🕐 Time Scheduling',
    difficulty: 'Intermediate',
    description: 'Exports stored energy during shoulder-rate periods (mid-afternoon) before the battery would hit full from solar, earning moderate feed-in revenue rather than curtailing.',
    whyUseIt: 'Great for households with large solar systems on time-of-use tariffs. Captures shoulder-rate export value that would otherwise be wasted if the battery fills before peak.',
    conditionSummary: ['Time: 14:00 – 16:00', 'Battery SoC ≥ 85%', 'Feed-in price ≥ 8¢/kWh'],
    rule: {
      enabled: false,
      priority: 7,
      cooldownMinutes: 60,
      conditions: {
        feedInPrice: { enabled: true, operator: '>=', value: 8, value2: null },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '>=', value: 85, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: true, startTime: '14:00', endTime: '16:00' }
      },
      action: {
        workMode: 'ForceDischarge',
        durationMinutes: 60,
        fdPwr: 2000,
        fdSoc: 60,
        minSocOnGrid: 25,
        maxSoc: 100
      }
    }
  },

  // ─────────────────────────────────────────────
  // 🌦️ SEASONAL & WEATHER
  // ─────────────────────────────────────────────
  {
    id: 'seasonal_hot_day_protect',
    name: 'Hot Day Battery Protection',
    category: 'seasonal',
    categoryLabel: '🌦️ Seasonal & Weather',
    difficulty: 'Intermediate',
    description: 'Limits battery charging and keeps SoC lower during hot ambient conditions, reducing heat stress on battery cells during peak summer temperatures.',
    whyUseIt: 'Great for summer months in hot climates (above 35°C). Ambient heat combined with charging heat generation accelerates cell degradation.',
    conditionSummary: ['Ambient temperature ≥ 35°C', 'Limits max SoC to 80%'],
    rule: {
      enabled: false,
      priority: 2,
      cooldownMinutes: 120,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: false },
        soc:         { enabled: false },
        temperature: { enabled: true, type: 'ambient', operator: '>=', value: 35 },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'SelfUse',
        durationMinutes: 240,
        fdPwr: 0,
        fdSoc: 0,
        minSocOnGrid: 20,
        maxSoc: 80
      }
    }
  },

  {
    id: 'seasonal_winter_self_use',
    name: 'Winter Self-Use Override',
    category: 'seasonal',
    categoryLabel: '🌦️ Seasonal & Weather',
    difficulty: 'Beginner',
    description: 'Forces self-use mode and a higher minimum SoC during cold morning hours when solar generation is minimal and you need grid backup comfort.',
    whyUseIt: 'Great for winter mornings in colder climates. Ensures the system doesn\'t deplete overnight reserves during periods of long dark nights and minimal solar.',
    conditionSummary: ['Time: 06:00 – 09:00', 'Ambient temperature ≤ 10°C', 'Battery SoC ≥ 20%'],
    rule: {
      enabled: false,
      priority: 4,
      cooldownMinutes: 60,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '>=', value: 20, value2: null },
        temperature: { enabled: true, type: 'ambient', operator: '<=', value: 10 },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: true, startTime: '06:00', endTime: '09:00' }
      },
      action: {
        workMode: 'SelfUse',
        durationMinutes: 180,
        fdPwr: 0,
        fdSoc: 0,
        minSocOnGrid: 30,
        maxSoc: 100
      }
    }
  },

  {
    id: 'seasonal_rainy_week_conserve',
    name: 'Rainy Week Battery Saver',
    category: 'seasonal',
    categoryLabel: '🌦️ Seasonal & Weather',
    difficulty: 'Advanced',
    description: 'When both the cloud cover forecast is high and solar radiation is low over the next day, reduces max SoC cycling and preserves battery for self-use — acknowledging that solar won\'t recharge fully for a while.',
    whyUseIt: 'Great for multi-day overcast weather events. Limits aggressive discharge/export so you keep a useful reserve throughout the cloudy period.',
    conditionSummary: ['Cloud cover avg ≥ 85% next 24h', 'Solar radiation avg ≤ 150 W/m² next 24h'],
    rule: {
      enabled: false,
      priority: 7,
      cooldownMinutes: 360,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: false },
        soc:         { enabled: false },
        temperature: { enabled: false },
        solarRadiation: { enabled: true, checkType: 'average', operator: '<=', value: 150, lookAhead: 1, lookAheadUnit: 'days' },
        cloudCover:     { enabled: true, checkType: 'average', operator: '>=', value: 85, lookAhead: 1, lookAheadUnit: 'days' },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'SelfUse',
        durationMinutes: 360,
        fdPwr: 0,
        fdSoc: 0,
        minSocOnGrid: 30,
        maxSoc: 100
      }
    }
  },

  // ─────────────────────────────────────────────
  // 🚗 EV-FRIENDLY
  // ─────────────────────────────────────────────
  {
    id: 'ev_morning_commute_precharge',
    name: 'Morning Commute Pre-charge',
    category: 'ev',
    categoryLabel: '🚗 EV-Friendly',
    difficulty: 'Beginner',
    description: 'Charges the home battery overnight using cheap off-peak electricity so daytime solar can be directed to EV charging rather than refilling the house battery.',
    whyUseIt: 'Great for EV households — ensures the home battery is full by morning so daytime solar goes toward the car. Eliminates competition between home battery and EV charging during the day.',
    conditionSummary: ['Time: 00:00 – 06:00', 'Buy price ≤ 15¢/kWh', 'Battery SoC ≤ 75%'],
    rule: {
      enabled: false,
      priority: 4,
      cooldownMinutes: 360,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: true, operator: '<=', value: 15, value2: null },
        soc:         { enabled: true, operator: '<=', value: 75, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: true, startTime: '00:00', endTime: '06:00' }
      },
      action: {
        workMode: 'ForceCharge',
        durationMinutes: 180,
        fdPwr: 0,
        fdSoc: 90,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  },

  {
    id: 'ev_evening_return_reserve',
    name: 'Evening Return Battery Reserve',
    category: 'ev',
    categoryLabel: '🚗 EV-Friendly',
    difficulty: 'Intermediate',
    description: 'Holds a healthy battery reserve during the evening peak so the home can run on stored solar while the EV charges from the grid at a lower overnight rate.',
    whyUseIt: 'Great for EV drivers who arrive home in the evening and plug in for overnight charging. Protects home battery from being drained by EV charger load during peak tariff hours.',
    conditionSummary: ['Time: 18:00 – 23:00', 'Battery SoC ≥ 30%', 'Buy price ≥ 20¢/kWh'],
    rule: {
      enabled: false,
      priority: 3,
      cooldownMinutes: 60,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: true, operator: '>=', value: 20, value2: null },
        soc:         { enabled: true, operator: '>=', value: 30, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: true, startTime: '18:00', endTime: '23:00' }
      },
      action: {
        workMode: 'SelfUse',
        durationMinutes: 300,
        fdPwr: 0,
        fdSoc: 0,
        minSocOnGrid: 40,
        maxSoc: 100
      }
    }
  },

  {
    id: 'ev_solar_surplus_discharge',
    name: 'Solar Surplus — Charge Everything',
    category: 'ev',
    categoryLabel: '🚗 EV-Friendly',
    difficulty: 'Advanced',
    description: 'When strong solar is forecast and the feed-in price is low, shifts the inverter to self-use with a reduced max SoC — letting surplus power flow to the EV charger via the home circuit rather than exporting cheaply.',
    whyUseIt: 'Great for homes where the EV charger draws from the home circuit and feed-in rates are poor. Redirects excess solar revenue into free car charging instead.',
    conditionSummary: ['Solar radiation avg > 700 W/m² next 4h', 'Feed-in price ≤ 8¢/kWh', 'Battery SoC ≥ 70%'],
    rule: {
      enabled: false,
      priority: 6,
      cooldownMinutes: 90,
      conditions: {
        feedInPrice: { enabled: true, operator: '<=', value: 8, value2: null },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '>=', value: 70, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: true, checkType: 'average', operator: '>=', value: 700, lookAhead: 4, lookAheadUnit: 'hours' },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'SelfUse',
        durationMinutes: 120,
        fdPwr: 0,
        fdSoc: 0,
        minSocOnGrid: 20,
        maxSoc: 85
      }
    }
  },

  {
    id: 'ev_weekend_surplus_export',
    name: 'Weekend EV Away — Full Export',
    category: 'ev',
    categoryLabel: '🚗 EV-Friendly',
    difficulty: 'Intermediate',
    description: 'When the EV is typically away for the weekend (no home EV load), exports battery energy at a controlled rate during moderate feed-in prices, since there\'s no car to soak up excess solar.',
    whyUseIt: 'Great for EV owners whose car is away on weekends. Improves export revenue on days when there\'s no EV to absorb surplus, while keeping discharge behavior predictable.',
    conditionSummary: ['Feed-in price ≥ 8¢/kWh', 'Battery SoC ≥ 90%', 'Time: 10:00 – 15:00'],
    rule: {
      enabled: false,
      priority: 8,
      cooldownMinutes: 120,
      conditions: {
        feedInPrice: { enabled: true, operator: '>=', value: 8, value2: null },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '>=', value: 90, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: true, startTime: '10:00', endTime: '15:00' }
      },
      action: {
        workMode: 'ForceDischarge',
        durationMinutes: 60,
        fdPwr: 3000,
        fdSoc: 40,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  },

  // ─────────────────────────────────────────────
  // ⚡ REAL-WORLD PATTERNS (from production users)
  // ─────────────────────────────────────────────
  {
    id: 'prod_evening_drain_sunny_tomorrow',
    name: 'Evening Drain — Sunny Forecast Tomorrow',
    category: 'solar',
    categoryLabel: '☀️ Solar Forecasting',
    difficulty: 'Intermediate',
    description: 'In the evening, exports stored battery energy at a moderate feed-in price because tomorrow\'s solar is forecast to fully recharge it. Also checks that no better feed-in price is expected in the next few hours (so you\'re not selling too early).',
    whyUseIt: 'One of the most popular patterns among active users. Lets you earn from stored energy tonight, confident that tomorrow\'s solar will refill the battery — without leaving money on the table.',
    conditionSummary: ['Time: 18:00 – 23:59', 'Feed-in price ≥ 8¢/kWh', 'Battery SoC > 50%', 'Solar avg > 150 W/m² next 24h (tomorrow sunny)', 'No spike forecast in next 4h (max ≤ 50¢)'],
    rule: {
      enabled: false,
      priority: 7,
      cooldownMinutes: 15,
      conditions: {
        feedInPrice: { enabled: true, operator: '>=', value: 8, value2: null },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '>', value: 50, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: true, checkType: 'average', operator: '>', value: 150, lookAhead: 24, lookAheadUnit: 'hours' },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: true, type: 'feedIn', checkType: 'max', operator: '<=', value: 50, lookAhead: 4, lookAheadUnit: 'hours' },
        time:           { enabled: true, startTime: '18:00', endTime: '23:59' }
      },
      action: {
        workMode: 'ForceDischarge',
        durationMinutes: 30,
        fdPwr: 5000,
        fdSoc: 50,
        minSocOnGrid: 20,
        maxSoc: 90
      }
    }
  },

  {
    id: 'prod_precharge_spike_forecast',
    name: 'Pre-charge Before Spike Window',
    category: 'price',
    categoryLabel: '💰 Price Optimisation',
    difficulty: 'Advanced',
    description: 'Pre-charges the battery during the day when a large feed-in price spike is forecast in the next 4–12 hours and grid buy prices are still cheap — preparing to discharge when the spike arrives.',
    whyUseIt: 'Real users consistently name this as their highest-ROI rule. If you know a spike is coming, charge cheaply now so you can sell expensive later. Works particularly well on volatile grids like Amber.',
    conditionSummary: ['Feed-in forecast max > 50¢ next 4h', 'Buy price < 12¢ now', 'Battery SoC < 65%', 'Time: 09:00 – 16:00'],
    rule: {
      enabled: false,
      priority: 5,
      cooldownMinutes: 10,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: true, operator: '<', value: 12, value2: null },
        soc:         { enabled: true, operator: '<', value: 65, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: true, type: 'feedIn', checkType: 'max', operator: '>', value: 50, lookAhead: 4, lookAheadUnit: 'hours' },
        time:           { enabled: true, startTime: '09:00', endTime: '16:00' }
      },
      action: {
        workMode: 'ForceCharge',
        durationMinutes: 30,
        fdPwr: 0,
        fdSoc: 95,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  },

  {
    id: 'prod_post_spike_self_use',
    name: 'Post-Spike Return to Self-Use',
    category: 'price',
    categoryLabel: '💰 Price Optimisation',
    difficulty: 'Intermediate',
    description: 'A "circuit breaker" companion to spike-export rules. Switches the inverter back to self-use mode once the feed-in price has dropped below a threshold, stopping unnecessary export after the spike window passes.',
    whyUseIt: 'Prevents the inverter from continuing to export at low prices after a spike ends. Pair this with a high-price export rule — this handles the graceful exit back to normal operation.',
    conditionSummary: ['Feed-in price < 11¢/kWh (spike has passed)', 'Switches back to SelfUse'],
    rule: {
      enabled: false,
      priority: 1,
      cooldownMinutes: 5,
      conditions: {
        feedInPrice: { enabled: true, operator: '<', value: 11, value2: null },
        buyPrice:    { enabled: false },
        soc:         { enabled: false },
        temperature: { enabled: false },
        solarRadiation: { enabled: false },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: false }
      },
      action: {
        workMode: 'SelfUse',
        durationMinutes: 30,
        fdPwr: 0,
        fdSoc: 0,
        minSocOnGrid: 20,
        maxSoc: 90
      }
    }
  },

  {
    id: 'prod_overnight_solar_plan',
    name: 'Overnight Solar Planning Charge',
    category: 'solar',
    categoryLabel: '☀️ Solar Forecasting',
    difficulty: 'Advanced',
    description: 'Overnight (midnight–6am), checks tomorrow\'s solar forecast: if it looks weak (low radiation next 24h), charges the battery toward a higher SoC target to cover tomorrow\'s loads. If solar is strong, only charges to a moderate level to leave room to absorb solar generation.',
    whyUseIt: 'Inspired by real users who run paired "sunny" and "cloudy" overnight rules. Adapts the overnight charge target to the next day\'s forecast — charging more before bad-solar days, less before good ones.',
    conditionSummary: ['Time: 00:00 – 06:00', 'Solar avg < 250 W/m² next 24h (cloudy day ahead)', 'Battery SoC ≤ 80%'],
    rule: {
      enabled: false,
      priority: 5,
      cooldownMinutes: 360,
      conditions: {
        feedInPrice: { enabled: false },
        buyPrice:    { enabled: false },
        soc:         { enabled: true, operator: '<=', value: 80, value2: null },
        temperature: { enabled: false },
        solarRadiation: { enabled: true, checkType: 'average', operator: '<', value: 250, lookAhead: 24, lookAheadUnit: 'hours' },
        cloudCover:     { enabled: false },
        forecastPrice:  { enabled: false },
        time:           { enabled: true, startTime: '00:00', endTime: '06:00' }
      },
      action: {
        workMode: 'ForceCharge',
        durationMinutes: 240,
        fdPwr: 0,
        fdSoc: 95,
        minSocOnGrid: 20,
        maxSoc: 100
      }
    }
  }

];
