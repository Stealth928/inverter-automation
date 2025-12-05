# Amber Historical Prices Feature

## Overview

The Amber Historical Prices feature allows users to view and analyze historical electricity prices from the Amber API over custom date ranges. This includes both buy prices (what you pay to import power) and feed-in prices (what you receive when exporting power).

## Features

### 📊 Interactive Chart
- **Dual-axis visualization** showing both buy and feed-in prices
- **Hover tooltips** with precise price information
- **Responsive design** that adapts to different screen sizes
- **Smooth animations** for better UX

### 📈 Statistics Panel
- **Buy Price Stats**: Min, Average, Max prices
- **Feed-in Stats**: Min, Average, Max prices
- **Color-coded values** for quick visual assessment
- **Automatic calculation** from the fetched data

### 🎛️ Input Controls
- **Date range picker** with intuitive date inputs
- **Resolution selector** (5-minute or 30-minute intervals)
- **Validation** with helpful error messages
- **Sensible defaults** (last 7 days by default)

### ✅ Smart Validation
- Start date must be before end date
- End date cannot be in the future
- Maximum range limited to 90 days for API stability
- Warning for large ranges (>14 days)
- Clear error messages for user guidance

## How to Use

### Step 1: Set Date Range
1. Navigate to **History & Reports** page
2. Click on the **Start Date** field
3. Select your desired start date
4. Click on the **End Date** field
5. Select your desired end date

### Step 2: Choose Resolution
- **5-minute**: More detailed data (higher API usage)
- **30-minute**: Balanced view (recommended for ranges >7 days)

### Step 3: Fetch Data
- Click the **📈 Fetch Prices** button
- Wait for the data to load (time varies based on range size)
- The chart and statistics will populate automatically

## Data Interpretation

### Buy Price (Orange Line)
- Represents the price you **pay** to import electricity from the grid
- Higher values = more expensive to buy power
- Lower values = cheaper to buy power
- Used to determine optimal times for charging batteries or using appliances

### Feed-in Price (Blue Line)
- Represents the price you **receive** when feeding power back to the grid
- Positive values = you earn money (good time to export)
- Negative values = you pay to export (rare, usually during low demand)
- Higher values = better returns for solar generation

### Statistics Panel
- **Min**: Lowest price in the selected period (best buying opportunity)
- **Avg**: Average price across all intervals
- **Max**: Highest price in the selected period (worst time to buy)

## API Limitations & Best Practices

### Rate Limiting
- Amber API has rate limits to protect service stability
- Results are cached for 30 days to minimize repeat calls
- Large ranges (>7 days) may take longer to fetch

### Date Range Guidelines
- **Recommended**: 1-7 days at 30-minute resolution
- **Maximum**: 90 days (enforced by validation)
- **Historical Depth**: Data availability depends on your Amber API tier

### Resolution Selection
- **5-minute intervals**: More detailed, but higher API usage
- **30-minute intervals**: Better for longer ranges, standard NEM interval
- Mix and match based on your needs

## Technical Details

### Backend Endpoint
```
GET /api/amber/prices
Query Parameters:
  - siteId: Your Amber site ID (required)
  - startDate: YYYY-MM-DD format (required)
  - endDate: YYYY-MM-DD format (required)
  - resolution: 5 or 30 (optional, default: 30)
```

### Data Structure
Each price interval contains:
- `startTime`: ISO 8601 timestamp
- `perKwh`: Price in cents per kWh
- `channelType`: 'general' (buy) or 'feedIn' (sell)
- `renewables`: Renewable percentage at that time
- `date`: Date component
- `duration`: Interval duration in minutes

### Frontend Integration
- Uses existing `apiClient` for API communication
- Integrates with Firebase authentication
- Compatible with existing shared styles
- Follows established UI patterns

## Troubleshooting

### "No Amber sites available"
- Check that your Amber API key is configured in Settings
- Verify your API key has the correct permissions
- Contact Amber support if the issue persists

### "Request timeout"
- Your connection may be slow or the API is overloaded
- Try a smaller date range
- Retry in a few moments

### Chart not displaying
- Check browser console for errors
- Ensure Chart.js library is loaded
- Try refreshing the page

### Dates greyed out
- Only dates up to today are available
- Cannot query future data
- Select a date within the valid range

## Features in Development

Planned enhancements:
- [ ] Export data to CSV
- [ ] Price alerts (notify when price drops below threshold)
- [ ] Comparison charts (compare different months/years)
- [ ] Custom time ranges with timezone support
- [ ] Mobile app notifications for cheap electricity

## Support

For issues or feature requests, please refer to the main README.md or contact support.
