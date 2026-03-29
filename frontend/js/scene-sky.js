(function (global) {
  'use strict';

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function parseMinutes(value) {
    if (typeof value === 'number' && isFinite(value)) {
      return clamp(Math.round(value), 0, 1439);
    }
    if (!value) return null;
    if (value instanceof Date) {
      return (value.getHours() * 60) + value.getMinutes();
    }
    var stringValue = String(value);
    var match = stringValue.match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    var hours = Number(match[1]);
    var minutes = Number(match[2]);
    if (!isFinite(hours) || !isFinite(minutes)) return null;
    return clamp((hours * 60) + minutes, 0, 1439);
  }

  function resolveCurrentMinutes(options) {
    var currentMinutes = parseMinutes(options && options.currentTimeMinutes);
    if (currentMinutes !== null) return currentMinutes;
    currentMinutes = parseMinutes(options && options.currentTime);
    if (currentMinutes !== null) return currentMinutes;
    return parseMinutes(new Date());
  }

  function resolveDayWindow(options) {
    var sunriseMinutes = parseMinutes(options && options.sunrise);
    var sunsetMinutes = parseMinutes(options && options.sunset);
    var dayStartMinutes = parseMinutes(options && options.dayStartMinutes);
    var dayEndMinutes = parseMinutes(options && options.dayEndMinutes);

    if (sunriseMinutes === null) sunriseMinutes = dayStartMinutes !== null ? dayStartMinutes : 360;
    if (sunsetMinutes === null) sunsetMinutes = dayEndMinutes !== null ? dayEndMinutes : 1080;
    if (sunsetMinutes <= sunriseMinutes) {
      sunsetMinutes = sunriseMinutes + 720;
    }

    return {
      sunriseMinutes: sunriseMinutes,
      sunsetMinutes: sunsetMinutes
    };
  }

  function getNightProgress(currentMinutes, sunriseMinutes, sunsetMinutes) {
    if (currentMinutes < sunriseMinutes) {
      return (currentMinutes + 1440 - sunsetMinutes) / ((sunriseMinutes + 1440) - sunsetMinutes);
    }
    return (currentMinutes - sunsetMinutes) / ((sunriseMinutes + 1440) - sunsetMinutes);
  }

  function getWeatherSkyModifiers(effect) {
    switch (String(effect || 'clear').toLowerCase()) {
      case 'cloudy':
        return {
          orbOpacityMultiplier: 0.58,
          orbSizeMultiplier: 0.96,
          orbBlur: 1.1,
          starsOpacityMultiplier: 0.34,
          daySkyOpacityMultiplier: 0.72,
          dayGlowOpacityMultiplier: 0.36,
          nightGlowOpacityMultiplier: 0.42
        };
      case 'fog':
        return {
          orbOpacityMultiplier: 0.30,
          orbSizeMultiplier: 0.94,
          orbBlur: 2.4,
          starsOpacityMultiplier: 0.06,
          daySkyOpacityMultiplier: 0.54,
          dayGlowOpacityMultiplier: 0.14,
          nightGlowOpacityMultiplier: 0.18
        };
      case 'drizzle':
        return {
          orbOpacityMultiplier: 0.46,
          orbSizeMultiplier: 0.94,
          orbBlur: 1.6,
          starsOpacityMultiplier: 0.16,
          daySkyOpacityMultiplier: 0.64,
          dayGlowOpacityMultiplier: 0.24,
          nightGlowOpacityMultiplier: 0.30
        };
      case 'rain':
        return {
          orbOpacityMultiplier: 0.34,
          orbSizeMultiplier: 0.90,
          orbBlur: 2.0,
          starsOpacityMultiplier: 0.04,
          daySkyOpacityMultiplier: 0.48,
          dayGlowOpacityMultiplier: 0.16,
          nightGlowOpacityMultiplier: 0.18
        };
      case 'storm':
        return {
          orbOpacityMultiplier: 0.14,
          orbSizeMultiplier: 0.84,
          orbBlur: 2.8,
          starsOpacityMultiplier: 0,
          daySkyOpacityMultiplier: 0.28,
          dayGlowOpacityMultiplier: 0.06,
          nightGlowOpacityMultiplier: 0.08
        };
      case 'snow':
        return {
          orbOpacityMultiplier: 0.50,
          orbSizeMultiplier: 1,
          orbBlur: 1.2,
          starsOpacityMultiplier: 0.12,
          daySkyOpacityMultiplier: 0.70,
          dayGlowOpacityMultiplier: 0.26,
          nightGlowOpacityMultiplier: 0.32
        };
      default:
        return {
          orbOpacityMultiplier: 1,
          orbSizeMultiplier: 1,
          orbBlur: 0,
          starsOpacityMultiplier: 1,
          daySkyOpacityMultiplier: 1,
          dayGlowOpacityMultiplier: 1,
          nightGlowOpacityMultiplier: 1
        };
    }
  }

  function getSceneSkyState(options) {
    var resolvedOptions = options || {};
    var currentMinutes = resolveCurrentMinutes(resolvedOptions);
    var windowState = resolveDayWindow(resolvedOptions);
    var sunriseMinutes = windowState.sunriseMinutes;
    var sunsetMinutes = windowState.sunsetMinutes;
    var explicitDay = typeof resolvedOptions.isDay === 'boolean' ? resolvedOptions.isDay : null;
    var isDay = explicitDay;

    if (isDay === null) {
      isDay = currentMinutes >= sunriseMinutes && currentMinutes < sunsetMinutes;
    }

    var progress = isDay
      ? clamp((currentMinutes - sunriseMinutes) / Math.max(1, sunsetMinutes - sunriseMinutes), 0, 1)
      : clamp(getNightProgress(currentMinutes, sunriseMinutes, sunsetMinutes), 0, 1);
    var intensity = Math.sin(progress * Math.PI);
    var weatherEffect = String(resolvedOptions.weatherEffect || resolvedOptions.effect || 'clear').toLowerCase();
    var weatherModifiers = getWeatherSkyModifiers(weatherEffect);
    var orbX = clamp(82 - (progress * 64), 16, 84);
    var orbY = isDay ? 10.5 : 12.5;
    var orbSize = (isDay ? (18 + (intensity * 14)) : (14 + (intensity * 9))) * weatherModifiers.orbSizeMultiplier;
    var orbOpacity = (isDay ? (0.72 + (intensity * 0.18)) : (0.68 + (intensity * 0.18))) * weatherModifiers.orbOpacityMultiplier;
    var starsOpacity = isDay ? 0 : clamp((0.26 + (intensity * 0.18)) * weatherModifiers.starsOpacityMultiplier, 0, 0.44);
    var daySkyOpacity = isDay ? ((0.12 + (intensity * 0.16)) * weatherModifiers.daySkyOpacityMultiplier) : 0;
    var dayGlowOpacity = isDay ? ((0.06 + (intensity * 0.18)) * weatherModifiers.dayGlowOpacityMultiplier) : 0;
    var nightTopOpacity = isDay ? 0.58 : (0.58 - (intensity * 0.08));
    var nightGlowOpacity = isDay ? 0 : ((0.06 + (intensity * 0.09)) * weatherModifiers.nightGlowOpacityMultiplier);
    var nightBottomOpacity = isDay ? 0.16 : (0.18 - (intensity * 0.05));
    var lightX = orbX;
    var orbBlur = weatherModifiers.orbBlur;
    var orbGlow = isDay
      ? '0 0 12px rgba(255, 220, 107, ' + ((0.16 + (intensity * 0.10)) * weatherModifiers.dayGlowOpacityMultiplier).toFixed(2) + '), 0 0 28px rgba(255, 181, 63, ' + ((0.05 + (intensity * 0.06)) * weatherModifiers.dayGlowOpacityMultiplier).toFixed(2) + ')'
      : '0 0 10px rgba(196, 219, 255, ' + ((0.18 + (intensity * 0.08)) * weatherModifiers.nightGlowOpacityMultiplier).toFixed(2) + '), 0 0 22px rgba(118, 153, 215, ' + ((0.05 + (intensity * 0.04)) * weatherModifiers.nightGlowOpacityMultiplier).toFixed(2) + ')';

    return {
      phase: isDay ? 'day' : 'night',
      isDay: isDay,
      progress: progress,
      intensity: intensity,
      weatherEffect: weatherEffect,
      orbX: orbX,
      orbY: orbY,
      orbSize: orbSize,
      orbBlur: orbBlur,
      orbOpacity: orbOpacity,
      starsOpacity: starsOpacity,
      lightX: lightX,
      daySkyOpacity: daySkyOpacity,
      dayGlowOpacity: dayGlowOpacity,
      nightTopOpacity: nightTopOpacity,
      nightGlowOpacity: nightGlowOpacity,
      nightBottomOpacity: nightBottomOpacity,
      orbCore: isDay
        ? 'radial-gradient(circle at 35% 35%, rgba(255, 249, 221, 1) 0%, rgba(255, 221, 116, 0.98) 40%, rgba(255, 179, 63, 0.92) 72%, rgba(255, 179, 63, 0.16) 100%)'
        : 'radial-gradient(circle at 36% 32%, rgba(255, 255, 255, 0.98) 0%, rgba(226, 237, 255, 0.95) 42%, rgba(176, 198, 232, 0.82) 72%, rgba(176, 198, 232, 0.12) 100%)',
      orbGlow: orbGlow,
      moonMaskOpacity: isDay ? 0 : 0.52,
      sunriseMinutes: sunriseMinutes,
      sunsetMinutes: sunsetMinutes,
      currentMinutes: currentMinutes
    };
  }

  function applySceneSky(scene, options) {
    if (!scene) return null;
    var state = getSceneSkyState(options);
    scene.setAttribute('data-sky-phase', state.phase);
    scene.style.setProperty('--scene-orb-x', state.orbX.toFixed(2) + '%');
    scene.style.setProperty('--scene-orb-y', state.orbY.toFixed(2) + '%');
    scene.style.setProperty('--scene-orb-size', state.orbSize.toFixed(2) + 'px');
    scene.style.setProperty('--scene-orb-blur', state.orbBlur.toFixed(2) + 'px');
    scene.style.setProperty('--scene-orb-opacity', state.orbOpacity.toFixed(2));
    scene.style.setProperty('--scene-stars-opacity', state.starsOpacity.toFixed(2));
    scene.style.setProperty('--scene-light-x', state.lightX.toFixed(2) + '%');
    scene.style.setProperty('--scene-day-sky-opacity', state.daySkyOpacity.toFixed(3));
    scene.style.setProperty('--scene-day-glow-opacity', state.dayGlowOpacity.toFixed(3));
    scene.style.setProperty('--scene-night-top-opacity', state.nightTopOpacity.toFixed(3));
    scene.style.setProperty('--scene-night-glow-opacity', state.nightGlowOpacity.toFixed(3));
    scene.style.setProperty('--scene-night-bottom-opacity', state.nightBottomOpacity.toFixed(3));
    scene.style.setProperty('--scene-orb-core', state.orbCore);
    scene.style.setProperty('--scene-orb-glow', state.orbGlow);
    scene.style.setProperty('--scene-moon-mask-opacity', state.moonMaskOpacity.toFixed(2));
    return state;
  }

  global.SoCratesSceneSky = {
    apply: applySceneSky,
    getState: getSceneSkyState
  };
})(window);