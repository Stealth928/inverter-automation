'use strict';

const {
  evaluateEVSoCCondition,
  evaluateEVLocationCondition,
  evaluateEVChargingStateCondition
} = require('../ev-conditions');

function createAutomationRuleEvaluationService(deps = {}) {
  const evaluateTemperatureCondition = deps.evaluateTemperatureCondition;
  const evaluateTimeCondition = deps.evaluateTimeCondition;
  const getCurrentAmberPrices = deps.getCurrentAmberPrices;
  const getUserTime = deps.getUserTime;
  const logger = deps.logger || { debug: () => {} };
  const parseAutomationTelemetry = deps.parseAutomationTelemetry;
  const resolveAutomationTimezone = deps.resolveAutomationTimezone;
  const getEVVehicleStatusMap = deps.getEVVehicleStatusMap || null; // optional

  if (typeof evaluateTemperatureCondition !== 'function') {
    throw new Error('createAutomationRuleEvaluationService requires evaluateTemperatureCondition()');
  }
  if (typeof evaluateTimeCondition !== 'function') {
    throw new Error('createAutomationRuleEvaluationService requires evaluateTimeCondition()');
  }
  if (typeof getCurrentAmberPrices !== 'function') {
    throw new Error('createAutomationRuleEvaluationService requires getCurrentAmberPrices()');
  }
  if (typeof getUserTime !== 'function') {
    throw new Error('createAutomationRuleEvaluationService requires getUserTime()');
  }
  if (typeof parseAutomationTelemetry !== 'function') {
    throw new Error('createAutomationRuleEvaluationService requires parseAutomationTelemetry()');
  }
  if (typeof resolveAutomationTimezone !== 'function') {
    throw new Error('createAutomationRuleEvaluationService requires resolveAutomationTimezone()');
  }

  async function evaluateRule(userId, ruleId, rule, cache, inverterData, userConfig, _skipCooldown = false) {
    // _skipCooldown: if true, we skip the cooldown check (used for re-evaluating active rules)
    const conditions = rule.conditions || {};
    const enabledConditions = [];
    const results = [];
    
    // Get user's timezone from config, fallback to Sydney
    const userTimezone = resolveAutomationTimezone(userConfig);
    const userTime = getUserTime(userTimezone);
    const currentMinutes = userTime.hour * 60 + userTime.minute;
    
    logger.debug('Automation', `Evaluating rule '${rule.name}' in timezone ${userTimezone} (${String(userTime.hour).padStart(2,'0')}:${String(userTime.minute).padStart(2,'0')})`);
    
    // Parse inverter data
    const { soc, batTemp, ambientTemp } = parseAutomationTelemetry(inverterData);
    
    // Parse Amber prices
    const { feedInPrice, buyPrice } = getCurrentAmberPrices(cache.amber);
    
    logger.debug('Automation', `Evaluating rule '${rule.name}' - Live data: SoC=${soc}%, BatTemp=${batTemp}°C, FeedIn=${feedInPrice?.toFixed(1)}¢, Buy=${buyPrice?.toFixed(1)}¢`);
    
    // Check SoC condition (support both 'op' and 'operator' field names)
    if (conditions.soc?.enabled) {
      enabledConditions.push('soc');
      if (soc !== null) {
        const operator = conditions.soc.op || conditions.soc.operator;
        const value = conditions.soc.value;
        const value2 = conditions.soc.value2;
        let met = false;
        if (operator === 'between' && value2 != null) {
          met = soc >= value && soc <= value2;
        } else {
          met = compareValue(soc, operator, value);
        }
        results.push({ condition: 'soc', met, actual: soc, operator, target: value });
        if (!met) {
          logger.debug('Automation', `Rule '${rule.name}' - SoC condition NOT met: ${soc} ${operator} ${value} = false`);
        }
      } else {
        results.push({ condition: 'soc', met: false, reason: 'No SoC data' });
        logger.debug('Automation', `Rule '${rule.name}' - SoC condition NOT met: No SoC data available`);
      }
    }
    
    // Check price condition (support both 'price' and 'feedInPrice/buyPrice' formats)
    // Frontend saves as conditions.price with 'type' field (feedIn or buy)
    const priceCondition = conditions.price;
    if (priceCondition?.enabled && priceCondition?.type) {
      const priceType = priceCondition.type; // 'feedIn' or 'buy'
      const actualPrice = priceType === 'feedIn' ? feedInPrice : buyPrice;
      enabledConditions.push('price');
      if (actualPrice !== null) {
        const operator = priceCondition.op || priceCondition.operator;
        const value = priceCondition.value;
        const value2 = priceCondition.value2;
        let met = false;
        if (operator === 'between' && value2 != null) {
          met = actualPrice >= value && actualPrice <= value2;
        } else {
          met = compareValue(actualPrice, operator, value);
        }
        results.push({ condition: 'price', met, actual: actualPrice, operator, target: value, type: priceType });
        if (!met) {
          logger.debug('Automation', `Rule '${rule.name}' - Price (${priceType}) condition NOT met: actual=${actualPrice} (type: ${typeof actualPrice}), target=${value} (type: ${typeof value}), operator=${operator}, result: ${actualPrice} ${operator} ${value} = false`);
        } else {
          logger.debug('Automation', `Rule '${rule.name}' - Price (${priceType}) condition MET: ${actualPrice} ${operator} ${value} = true`);
        }
      } else {
        results.push({ condition: 'price', met: false, reason: 'No Amber price data' });
        logger.debug('Automation', `Rule '${rule.name}' - Price condition NOT met: No Amber data available`);
      }
    }
    
    // Legacy: Check feed-in price condition (for old format rules)
    if (conditions.feedInPrice?.enabled) {
      enabledConditions.push('feedInPrice');
      if (feedInPrice !== null) {
        const operator = conditions.feedInPrice.op || conditions.feedInPrice.operator;
        const value = conditions.feedInPrice.value;
        const value2 = conditions.feedInPrice.value2;
        let met = false;
        if (operator === 'between' && value2 != null) {
          met = feedInPrice >= value && feedInPrice <= value2;
        } else {
          met = compareValue(feedInPrice, operator, value);
        }
        results.push({ condition: 'feedInPrice', met, actual: feedInPrice, operator, target: value });
        if (!met) {
          logger.debug('Automation', `Rule '${rule.name}' - FeedIn condition NOT met: actual=${feedInPrice} (type: ${typeof feedInPrice}), target=${value} (type: ${typeof value}), operator=${operator}, result: ${feedInPrice} ${operator} ${value} = false`);
        } else {
          logger.debug('Automation', `Rule '${rule.name}' - FeedIn condition MET: ${feedInPrice} ${operator} ${value} = true`);
        }
      } else {
        results.push({ condition: 'feedInPrice', met: false, reason: 'No Amber data' });
        logger.debug('Automation', `Rule '${rule.name}' - FeedIn condition NOT met: No Amber data available`);
      }
    }
    
    // Check buy price condition
    if (conditions.buyPrice?.enabled) {
      enabledConditions.push('buyPrice');
      if (buyPrice !== null) {
        const operator = conditions.buyPrice.op || conditions.buyPrice.operator;
        const value = conditions.buyPrice.value;
        const value2 = conditions.buyPrice.value2;
        let met = false;
        if (operator === 'between' && value2 != null) {
          met = buyPrice >= value && buyPrice <= value2;
        } else {
          met = compareValue(buyPrice, operator, value);
        }
        results.push({ condition: 'buyPrice', met, actual: buyPrice, operator, target: value });
        if (!met) {
          logger.debug('Automation', `Rule '${rule.name}' - BuyPrice condition NOT met: actual=${buyPrice} (type: ${typeof buyPrice}), target=${value} (type: ${typeof value}), operator=${operator}, result: ${buyPrice} ${operator} ${value} = false`);
        } else {
          logger.debug('Automation', `Rule '${rule.name}' - BuyPrice condition MET: ${buyPrice} ${operator} ${value} = true`);
        }
      } else {
        results.push({ condition: 'buyPrice', met: false, reason: 'No Amber data' });
        logger.debug('Automation', `Rule '${rule.name}' - BuyPrice condition NOT met: No Amber data available`);
      }
    }
    
    // Check temperature condition (support both 'temp' and 'temperature' with 'op' and 'operator')
    const tempCondition = conditions.temp || conditions.temperature;
    if (tempCondition?.enabled) {
      enabledConditions.push('temperature');
      const tempResult = evaluateTemperatureCondition(tempCondition, {
        batteryTemp: batTemp,
        ambientTemp,
        weatherData: cache.weather
      });
  
      if (tempResult.reason) {
        results.push({
          condition: 'temperature',
          met: false,
          reason: tempResult.reason,
          type: tempResult.type,
          source: tempResult.source,
          dayOffset: tempResult.dayOffset
        });
        logger.debug('Automation', `Rule '${rule.name}' - Temperature condition NOT met: ${tempResult.reason}`);
      } else {
        results.push({
          condition: 'temperature',
          met: tempResult.met,
          actual: tempResult.actual,
          operator: tempResult.operator,
          target: tempResult.target,
          target2: tempResult.target2,
          type: tempResult.type,
          source: tempResult.source,
          metric: tempResult.metric,
          dayOffset: tempResult.dayOffset
        });
        if (!tempResult.met) {
          logger.debug(
            'Automation',
            `Rule '${rule.name}' - Temperature condition NOT met: ${tempResult.actual} ${tempResult.operator} ${tempResult.target} = false`
          );
        }
      }
    }
    
    // Check time window condition
    const timeCondition = conditions.time || conditions.timeWindow;
    if (timeCondition?.enabled) {
      enabledConditions.push('time');
      const timeResult = evaluateTimeCondition(timeCondition, {
        timezone: userTimezone,
        userTime,
        currentMinutes
      });
  
      results.push({
        condition: 'time',
        met: timeResult.met,
        actual: timeResult.actualTime,
        window: `${timeResult.startTime}-${timeResult.endTime}`,
        days: timeResult.days,
        daysLabel: timeResult.daysLabel,
        dayMatched: timeResult.dayMatched
      });
      if (!timeResult.met) {
        logger.debug(
          'Automation',
          `Rule '${rule.name}' - Time condition NOT met: ${timeResult.actualTime} not in ${timeResult.startTime}-${timeResult.endTime} (${timeResult.daysLabel})`
        );
      }
    }
    
    /**
     * Find the starting hour index in weather hourly data for timezone-aware time comparison
     * Open-Meteo returns times like "2025-12-17T00:00" in the user's timezone (no Z suffix)
     * This function correctly matches current local time to the hourly array
     */
    function findWeatherStartIndex(hourlyTimes, weatherTz = 'Australia/Sydney') {
      if (!hourlyTimes || hourlyTimes.length === 0) return 0;
      
      // Get current time in the weather's timezone
      const userLocalTime = new Date().toLocaleString('en-AU', { timeZone: weatherTz, hour12: false });
      const [userDatePart, userTimePart] = userLocalTime.split(', ');
      const [userHour, userMinute] = userTimePart.split(':').slice(0, 2).map(Number);
      const [userDay, userMonth, userYear] = userDatePart.split('/').map(Number);
      
      // Current time as comparison strings
      const currentHourStr = `${String(userHour).padStart(2, '0')}:${String(userMinute).padStart(2, '0')}`;
      const currentDateStr = `${userYear}-${String(userMonth).padStart(2, '0')}-${String(userDay).padStart(2, '0')}`;
      
      // Find first hour that's in the future (or current hour if no future)
      let startIdx = 0;
      for (let i = 0; i < hourlyTimes.length; i++) {
        const timeStr = hourlyTimes[i]; // e.g., "2025-12-17T00:00"
        const [dateOnly, timeOnly] = timeStr.split('T');
        
        // If this hour's date is after today, use this index
        if (dateOnly > currentDateStr) {
          startIdx = i;
          break;
        } else if (dateOnly === currentDateStr) {
          // Same day - use this hour if it's in the future
          if (timeOnly > currentHourStr) {
            startIdx = i;
            break;
          }
          // Otherwise keep searching
        }
        // If dateOnly < currentDateStr, this hour is in the past, keep going
      }
      
      return startIdx;
    }
    
    // Check solar radiation condition (new separate condition)
    if (conditions.solarRadiation?.enabled) {
      enabledConditions.push('solarRadiation');
      const weatherData = cache.weather;
      const hourly = weatherData?.result?.hourly || weatherData?.hourly;
      
      if (hourly?.shortwave_radiation && hourly?.time) {
        // Support lookAheadUnit: hours or days
        const lookAheadUnit = conditions.solarRadiation.lookAheadUnit || 'hours';
        const lookAheadValue = conditions.solarRadiation.lookAhead || 6;
        const lookAheadHours = lookAheadUnit === 'days' ? lookAheadValue * 24 : lookAheadValue;
        
        const threshold = conditions.solarRadiation.value || 200; // W/m² default
        const operator = conditions.solarRadiation.operator || '>';
        const checkType = conditions.solarRadiation.checkType || 'average';
        
        // Get timezone-aware starting index
        const forecastTz = weatherData?.result?.place?.timezone || 'Australia/Sydney';
        const startIdx = findWeatherStartIndex(hourly.time, forecastTz);
        
        // Get radiation values for next N hours (starting from current/next hour)
        const endIdx = Math.min(startIdx + lookAheadHours, hourly.shortwave_radiation.length);
        const radiationValues = hourly.shortwave_radiation.slice(startIdx, endIdx);
        const hoursRequested = lookAheadHours;
        const hoursRetrieved = radiationValues.length;
        
        if (radiationValues.length > 0) {
          let actualValue;
          if (checkType === 'min') {
            actualValue = Math.min(...radiationValues);
          } else if (checkType === 'max') {
            actualValue = Math.max(...radiationValues);
          } else {
            actualValue = radiationValues.reduce((a, b) => a + b, 0) / radiationValues.length;
          }
          
          const value2 = conditions.solarRadiation.value2;
          const met = (operator === 'between' && value2 != null)
            ? compareValue(actualValue, 'between', threshold, value2)
            : compareValue(actualValue, operator, threshold);
          const lookAheadDisplay = lookAheadUnit === 'days' ? `${lookAheadValue}d` : `${lookAheadValue}h`;
          
          // Warn if we got fewer hours than requested (incomplete timeframe)
          const hasIncompleteData = hoursRetrieved < hoursRequested;
          if (hasIncompleteData) {
            console.warn(`[Automation] Rule '${rule.name}' - Solar radiation: Only got ${hoursRetrieved} of ${hoursRequested} hours requested`);
          }
          
          results.push({ 
            condition: 'solarRadiation', 
            met, 
            actual: (actualValue !== undefined && actualValue !== null) ? actualValue.toFixed(0) : '0', 
            operator,
            target: threshold,
            unit: 'W/m²',
            lookAhead: lookAheadDisplay,
            checkType,
            hoursChecked: radiationValues.length,
            hoursRequested,
            incomplete: hasIncompleteData
          });
          if (!met) {
            logger.debug('Automation', `Rule '${rule.name}' - Solar radiation NOT met: ${checkType} ${actualValue?.toFixed(0)} W/m² ${operator} ${threshold} W/m²`);
          }
        } else {
          results.push({ condition: 'solarRadiation', met: false, reason: 'No radiation data for timeframe' });
        }
      } else {
        results.push({ condition: 'solarRadiation', met: false, reason: 'No hourly radiation data' });
      }
    }
    
    // Check cloud cover condition (new separate condition)
    if (conditions.cloudCover?.enabled) {
      enabledConditions.push('cloudCover');
      const weatherData = cache.weather;
      const hourly = weatherData?.result?.hourly || weatherData?.hourly;
      
      if (hourly?.cloudcover && hourly?.time) {
        // Support lookAheadUnit: hours or days
        const lookAheadUnit = conditions.cloudCover.lookAheadUnit || 'hours';
        const lookAheadValue = conditions.cloudCover.lookAhead || 6;
        const lookAheadHours = lookAheadUnit === 'days' ? lookAheadValue * 24 : lookAheadValue;
        
        const threshold = conditions.cloudCover.value || 50; // % default
        const operator = conditions.cloudCover.operator || '<';
        const checkType = conditions.cloudCover.checkType || 'average';
        
        // Get timezone-aware starting index
        const forecastTz = weatherData?.result?.place?.timezone || 'Australia/Sydney';
        const startIdx = findWeatherStartIndex(hourly.time, forecastTz);
        
        const endIdx = Math.min(startIdx + lookAheadHours, hourly.cloudcover.length);
        const cloudValues = hourly.cloudcover.slice(startIdx, endIdx);
        const hoursRequested = lookAheadHours;
        const hoursRetrieved = cloudValues.length;
        
        if (cloudValues.length > 0) {
          let actualValue;
          if (checkType === 'min') {
            actualValue = Math.min(...cloudValues);
          } else if (checkType === 'max') {
            actualValue = Math.max(...cloudValues);
          } else {
            actualValue = cloudValues.reduce((a, b) => a + b, 0) / cloudValues.length;
          }
          
          const value2 = conditions.cloudCover.value2;
          const met = (operator === 'between' && value2 != null)
            ? compareValue(actualValue, 'between', threshold, value2)
            : compareValue(actualValue, operator, threshold);
          const lookAheadDisplay = lookAheadUnit === 'days' ? `${lookAheadValue}d` : `${lookAheadValue}h`;
          
          // Warn if we got fewer hours than requested (incomplete timeframe)
          const hasIncompleteData = hoursRetrieved < hoursRequested;
          if (hasIncompleteData) {
            console.warn(`[Automation] Rule '${rule.name}' - Cloud cover: Only got ${hoursRetrieved} of ${hoursRequested} hours requested`);
          }
          
          results.push({ 
            condition: 'cloudCover', 
            met, 
            actual: (actualValue !== undefined && actualValue !== null) ? actualValue.toFixed(0) : '0', 
            operator,
            target: threshold,
            unit: '%',
            lookAhead: lookAheadDisplay,
            checkType,
            hoursChecked: cloudValues.length,
            hoursRequested,
            incomplete: hasIncompleteData
          });
          if (!met) {
            logger.debug('Automation', `Rule '${rule.name}' - Cloud cover NOT met: ${checkType} ${actualValue?.toFixed(0)}% ${operator} ${threshold}%`);
          }
        } else {
          results.push({ condition: 'cloudCover', met: false, reason: 'No cloud cover data' });
        }
      } else {
        results.push({ condition: 'cloudCover', met: false, reason: 'No hourly cloud data' });
      }
    }
    
    // Legacy weather condition (for backward compatibility with old rules)
    if (conditions.weather?.enabled) {
      enabledConditions.push('weather');
      const weatherData = cache.weather;
      
      // Check if this is an old-style radiation/cloudcover rule (migrate to new format)
      if (conditions.weather.type === 'radiation' || conditions.weather.radiationEnabled ||
          conditions.weather.type === 'solar' || conditions.weather.type === 'cloudcover') {
        // This is a legacy rule using the old weather.type format - evaluate it for compatibility
        if (conditions.weather.type === 'solar' || conditions.weather.type === 'radiation' || conditions.weather.radiationEnabled) {
          const hourly = weatherData?.result?.hourly || weatherData?.hourly;
          if (hourly?.shortwave_radiation && hourly?.time) {
            const lookAheadHours = conditions.weather.radiationHours || conditions.weather.lookAheadHours || 6;
            const threshold = conditions.weather.radiationThreshold || 200;
            const rawOp = conditions.weather.radiationOp || '>';
            // Parse operator from combined string like 'avg>' or simple '>'
            const operator = rawOp.replace('avg', '').replace('min', '').replace('max', '') || '>';
            const checkType = rawOp.includes('min') ? 'min' : rawOp.includes('max') ? 'max' : 'average';
            
            const now = new Date();
            const currentHour = now.getHours();
            let startIdx = 0;
            for (let i = 0; i < hourly.time.length; i++) {
              const t = new Date(hourly.time[i]);
              if (t.getHours() >= currentHour && t.getDate() === now.getDate()) {
                startIdx = i;
                break;
              }
            }
            
            const endIdx = Math.min(startIdx + lookAheadHours, hourly.shortwave_radiation.length);
            const radiationValues = hourly.shortwave_radiation.slice(startIdx, endIdx);
            
            if (radiationValues.length > 0) {
              let actualValue;
              if (checkType === 'min') actualValue = Math.min(...radiationValues);
              else if (checkType === 'max') actualValue = Math.max(...radiationValues);
              else actualValue = radiationValues.reduce((a, b) => a + b, 0) / radiationValues.length;
              
              const met = compareValue(actualValue, operator, threshold);
              results.push({ condition: 'weather', met, type: 'radiation', actual: actualValue?.toFixed(0), operator, target: threshold, unit: 'W/m²', legacy: true });
            } else {
              results.push({ condition: 'weather', met: false, reason: 'No radiation data' });
            }
          } else {
            results.push({ condition: 'weather', met: false, reason: 'No hourly data' });
          }
        } else if (conditions.weather.type === 'cloudcover') {
          const hourly = weatherData?.result?.hourly || weatherData?.hourly;
          if (hourly?.cloudcover && hourly?.time) {
            const lookAheadHours = conditions.weather.cloudcoverHours || conditions.weather.lookAheadHours || 6;
            const threshold = conditions.weather.cloudcoverThreshold || 50;
            const rawOp = conditions.weather.cloudcoverOp || '<';
            const operator = rawOp.replace('avg', '').replace('min', '').replace('max', '') || '<';
            const checkType = rawOp.includes('min') ? 'min' : rawOp.includes('max') ? 'max' : 'average';
            
            // Get timezone-aware starting index
            const forecastTz = weatherData?.result?.place?.timezone || 'Australia/Sydney';
            const startIdx = findWeatherStartIndex(hourly.time, forecastTz);
            
            const endIdx = Math.min(startIdx + lookAheadHours, hourly.cloudcover.length);
            const cloudValues = hourly.cloudcover.slice(startIdx, endIdx);
            
            if (cloudValues.length > 0) {
              let actualValue;
              if (checkType === 'min') actualValue = Math.min(...cloudValues);
              else if (checkType === 'max') actualValue = Math.max(...cloudValues);
              else actualValue = cloudValues.reduce((a, b) => a + b, 0) / cloudValues.length;
              
              const met = compareValue(actualValue, operator, threshold);
              results.push({ condition: 'weather', met, type: 'cloudcover', actual: (actualValue !== undefined && actualValue !== null) ? actualValue.toFixed(0) : '0', operator, target: threshold, unit: '%', legacy: true });
            } else {
              results.push({ condition: 'weather', met: false, reason: 'No cloud data' });
            }
          } else {
            results.push({ condition: 'weather', met: false, reason: 'No hourly data' });
          }
        }
      }
      // Legacy weathercode-based condition (sunny/cloudy/rainy)
      else if (weatherData?.current_weather) {
        const currentCode = weatherData.current_weather.weathercode;
        const weatherType = conditions.weather.condition || conditions.weather.type || 'any';
        
        let met = false;
        if (weatherType === 'any') {
          met = true;
        } else if (weatherType === 'sunny' || weatherType === 'clear') {
          met = currentCode <= 1;
        } else if (weatherType === 'cloudy') {
          met = currentCode >= 2 && currentCode <= 48;
        } else if (weatherType === 'rainy') {
          met = currentCode >= 51;
        }
        
        const codeDesc = currentCode <= 1 ? 'Clear' : currentCode <= 3 ? 'Partly Cloudy' : currentCode <= 48 ? 'Cloudy/Fog' : currentCode <= 67 ? 'Rain' : 'Storm';
        results.push({ condition: 'weather', met, type: 'weathercode', actual: codeDesc, target: weatherType, weatherCode: currentCode, legacy: true });
      } else {
        results.push({ condition: 'weather', met: false, reason: 'No weather data' });
      }
    }
    
    // Check forecast price condition (future amber prices - supports minutes, hours, or days)
    if (conditions.forecastPrice?.enabled) {
      enabledConditions.push('forecastPrice');
      const amberData = cache.amber;
      if (Array.isArray(amberData)) {
        const priceType = conditions.forecastPrice.type || 'general'; // 'general' (buy) or 'feedIn'
        const channelType = priceType === 'feedIn' ? 'feedIn' : 'general';
        
        // Support different time units: minutes (default), hours, days
        const lookAheadUnit = conditions.forecastPrice.lookAheadUnit || 'minutes';
        let lookAheadMinutes;
        if (lookAheadUnit === 'days') {
          lookAheadMinutes = (conditions.forecastPrice.lookAhead || 1) * 24 * 60;
        } else if (lookAheadUnit === 'hours') {
          lookAheadMinutes = (conditions.forecastPrice.lookAhead || 1) * 60;
        } else {
          lookAheadMinutes = conditions.forecastPrice.lookAhead || 30;
        }
        
        const intervalsNeeded = Math.ceil(lookAheadMinutes / 5); // 5-min intervals
        
        // Get forecast intervals for the specified channel, sorted by time
        const forecasts = amberData.filter(p => p.channelType === channelType && p.type === 'ForecastInterval');
        
        // CRITICAL FIX: Filter by time window (now to now + lookAheadMinutes) instead of just taking first N
        const now = new Date();
        const cutoffTime = new Date(now.getTime() + lookAheadMinutes * 60 * 1000);
        
        // Filter for intervals that fall within [now, cutoffTime]
        // startTime <= cutoffTime (ends before/at cutoff) and endTime >= now (starts before/at now)
        const relevantForecasts = forecasts.filter(f => {
          const startTime = new Date(f.startTime);
          const endTime = new Date(f.endTime || startTime.getTime() + 5 * 60 * 1000);
          // Include if interval overlaps with our window
          return startTime <= cutoffTime && endTime >= now;
        }).slice(0, intervalsNeeded); // Still limit to intervalsNeeded in case of overlap
        
        // LOG: Show what forecast data we have
        console.log(`[ForecastPrice] Rule '${rule.name}' - Type: ${priceType}, CheckType: ${conditions.forecastPrice.checkType || 'average'}`);
        console.log(`[ForecastPrice] Requested: ${lookAheadMinutes} minutes (${intervalsNeeded} intervals)`);
        console.log(`[ForecastPrice] Found ${forecasts.length} total forecast intervals in Amber data`);
        console.log(`[ForecastPrice] Filtered to ${relevantForecasts.length} intervals in time window [now -> +${lookAheadMinutes}min]`);
        if (forecasts.length > 0) {
          const firstTime = new Date(forecasts[0].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
          const lastTime = new Date(forecasts[forecasts.length - 1].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
          console.log(`[ForecastPrice] Available data time range: ${firstTime} to ${lastTime}`);
          // Show first 5 prices to see what we're working with
          const firstPrices = forecasts.slice(0, 5).map(f => `${new Date(f.startTime).toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Australia/Sydney'})}=${(priceType === 'feedIn' ? -f.perKwh : f.perKwh).toFixed(1)}¢`);
          console.log(`[ForecastPrice] First 5 prices (all data): ${firstPrices.join(', ')}`);
        }
        if (relevantForecasts.length > 0) {
          const relevantFirst = new Date(relevantForecasts[0].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
          const relevantLast = new Date(relevantForecasts[relevantForecasts.length-1].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
          console.log(`[ForecastPrice] Relevant time range (filtered): ${relevantFirst} to ${relevantLast}`);
        }
        
        // Check if we got fewer intervals than requested (Amber API limit is ~12 intervals = 1 hour)
        const intervalsActuallyAvailable = forecasts.length;
        const hasIncompleteData = relevantForecasts.length < intervalsNeeded;
        
        if (hasIncompleteData && intervalsActuallyAvailable < intervalsNeeded) {
          console.warn(`[Automation] Rule '${rule.name}' - Forecast ${priceType}: Only ${relevantForecasts.length} intervals in time window, requested ${intervalsNeeded}`);
        }
        
        if (relevantForecasts.length > 0) {
          // Calculate average or check specific criteria
          const checkType = conditions.forecastPrice.checkType || 'average'; // 'average', 'min', 'max', 'any'
          const prices = relevantForecasts.map(f => priceType === 'feedIn' ? -f.perKwh : f.perKwh);
          
          // LOG: Show all prices being considered
          console.log(`[ForecastPrice] Evaluating ${relevantForecasts.length} intervals, prices: ${prices.map(p => p.toFixed(1)).join(', ')}`);
          
          let actualValue;
          if (checkType === 'min') {
            actualValue = Math.min(...prices);
          } else if (checkType === 'max') {
            actualValue = Math.max(...prices);
          } else if (checkType === 'any') {
            actualValue = prices.find(p => compareValue(p, conditions.forecastPrice.operator, conditions.forecastPrice.value));
          } else {
            actualValue = prices.reduce((a, b) => a + b, 0) / prices.length; // average
          }
          
          console.log(`[ForecastPrice] Calculated ${checkType}: ${actualValue?.toFixed(1)}¢ (comparing ${conditions.forecastPrice.operator} ${conditions.forecastPrice.value}¢)`);
  
          
          const operator = conditions.forecastPrice.operator;
          const value = conditions.forecastPrice.value;
          const forecastValue2 = conditions.forecastPrice.value2;
          const met = checkType === 'any'
            ? actualValue !== undefined
            : (operator === 'between' && forecastValue2 != null)
              ? compareValue(actualValue, 'between', value, forecastValue2)
              : compareValue(actualValue, operator, value);
          
          // Format lookAhead for display
          const lookAheadDisplay = lookAheadUnit === 'days' 
            ? `${conditions.forecastPrice.lookAhead}d`
            : lookAheadUnit === 'hours'
            ? `${conditions.forecastPrice.lookAhead}h`
            : `${conditions.forecastPrice.lookAhead}m`;
          
          results.push({ 
            condition: 'forecastPrice', 
            met, 
            actual: actualValue?.toFixed(1), 
            operator, 
            target: value, 
            type: priceType, 
            lookAhead: lookAheadDisplay,
            lookAheadMinutes,
            checkType,
            intervalsChecked: relevantForecasts.length,
            intervalsAvailable: forecasts.length,
            incomplete: hasIncompleteData
          });
          if (!met) {
            logger.debug('Automation', `Rule '${rule.name}' - Forecast ${priceType} condition NOT met: ${checkType} ${actualValue?.toFixed(1)}¢ ${operator} ${value}¢ (${lookAheadDisplay})`);
          }
        } else {
          results.push({ condition: 'forecastPrice', met: false, reason: 'No forecast data' });
          logger.debug('Automation', `Rule '${rule.name}' - Forecast price condition NOT met: No forecast data available`);
        }
      } else {
        results.push({ condition: 'forecastPrice', met: false, reason: 'No Amber data' });
        logger.debug('Automation', `Rule '${rule.name}' - Forecast price condition NOT met: No Amber data available`);
      }
    }

    // Check EV conditions (evVehicleSoC, evVehicleLocation, evChargingState)
    const hasEvCondition = conditions.evVehicleSoC?.enabled ||
      conditions.evVehicleLocation?.enabled ||
      conditions.evChargingState?.enabled;

    if (hasEvCondition) {
      // Populate EV status map from cache or by fetching
      let evVehicleStatusMap = cache.evVehicleStatusMap || null;
      if (!evVehicleStatusMap && typeof getEVVehicleStatusMap === 'function') {
        try {
          evVehicleStatusMap = await getEVVehicleStatusMap(userId);
        } catch (evErr) {
          logger.debug('Automation', `Rule '${rule.name}' - Failed to fetch EV status: ${evErr.message}`);
        }
      }
      const evCtx = { evVehicleStatusMap: evVehicleStatusMap || {} };

      if (conditions.evVehicleSoC?.enabled) {
        enabledConditions.push('evVehicleSoC');
        const r = evaluateEVSoCCondition(conditions.evVehicleSoC, evCtx);
        results.push({ condition: 'evVehicleSoC', ...r });
      }
      if (conditions.evVehicleLocation?.enabled) {
        enabledConditions.push('evVehicleLocation');
        const r = evaluateEVLocationCondition(conditions.evVehicleLocation, evCtx);
        results.push({ condition: 'evVehicleLocation', ...r });
      }
      if (conditions.evChargingState?.enabled) {
        enabledConditions.push('evChargingState');
        const r = evaluateEVChargingStateCondition(conditions.evChargingState, evCtx);
        results.push({ condition: 'evChargingState', ...r });
      }
    }

    // Determine if all conditions are met
    const allMet = results.length > 0 && results.every(r => r.met);
    
    if (enabledConditions.length === 0) {
      logger.debug('Automation', `Rule '${rule.name}' - No conditions enabled, skipping`);
      return { triggered: false, reason: 'No conditions enabled', feedInPrice, buyPrice };
    }
    
    if (allMet) {
      logger.debug('Automation', `Rule '${rule.name}' - ALL ${enabledConditions.length} conditions MET!`);
      return { triggered: true, results, feedInPrice, buyPrice };
    }
    
    logger.debug('Automation', `Rule '${rule.name}' - Not all conditions met (${results.filter(r => r.met).length}/${results.length})`);
    return { triggered: false, results, feedInPrice, buyPrice };
  }

  function compareValue(actual, operator, target, target2) {
    if (actual === null || actual === undefined) return false;
    switch (operator) {
      case '>': return actual > target;
      case '>=': return actual >= target;
      case '<': return actual < target;
      case '<=': return actual <= target;
      case '==': return actual == target;
      case '!=': return actual != target;
      case 'between':
        // Support multiple calling conventions:
        // 1. compareValue(actual, 'between', min, max)  — preferred
        // 2. compareValue(actual, 'between', [min, max]) — legacy array
        // 3. compareValue(actual, 'between', {min, max}) — legacy object
        if (target2 != null) return actual >= Math.min(target, target2) && actual <= Math.max(target, target2);
        if (Array.isArray(target)) return actual >= target[0] && actual <= target[1];
        if (target && typeof target === 'object') return actual >= (target.min || 0) && actual <= (target.max || 100);
        return false;
      default: return false;
    }
  }

  return {
    compareValue,
    evaluateRule
  };
}

module.exports = {
  createAutomationRuleEvaluationService
};
