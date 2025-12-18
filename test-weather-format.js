const fetch = require("node-fetch");

async function test() {
  try {
    const geoUrl = "https://geocoding-api.open-meteo.com/v1/search?name=Roselands,Australia&count=1&language=en";
    const geoResp = await fetch(geoUrl);
    const geoData = await geoResp.json();
    
    if (!geoData.results || geoData.results.length === 0) {
      console.log("No geocoding results");
      return;
    }
    
    const result = geoData.results[0];
    const { latitude, longitude } = result;
    
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=shortwave_radiation,cloudcover,time&current_weather=true&temperature_unit=celsius&timezone=auto&forecast_days=1`;
    
    const forecastResp = await fetch(forecastUrl);
    const forecastJson = await forecastResp.json();
    
    console.log("Weather timezone:", forecastJson.timezone);
    console.log("First 5 time entries:", forecastJson.hourly.time.slice(0, 5));
    console.log("First 5 radiation values:", forecastJson.hourly.shortwave_radiation.slice(0, 5));
    
    // Test time parsing
    const t = new Date(forecastJson.hourly.time[0]);
    console.log("\nTime parsing test:");
    console.log("Original string:", forecastJson.hourly.time[0]);
    console.log("Parsed as Date:", t);
    console.log("getTime():", t.getTime());
    console.log("toISOString():", t.toISOString());
  } catch (e) {
    console.error("Error:", e.message);
  }
}

test();
