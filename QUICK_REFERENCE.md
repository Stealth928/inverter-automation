# Amber Historical Prices Feature - Quick Reference Guide

## UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  💰 Amber Price History                              [timestamp] │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  📅 Controls Row                                                 │
│  ┌──────────┬──────────┬──────────┬──────────────────┐           │
│  │ Start    │ End Date │Resolution│ 📈 Fetch Prices  │           │
│  │ Date     │          │  5/30min │     [Loading]    │           │
│  └──────────┴──────────┴──────────┴──────────────────┘           │
│                                                                   │
│  📊 Statistics (shown after fetch)                               │
│  ┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐  │
│  │ Buy Min │ Buy Avg │ Buy Max │Feed Min │Feed Avg │Feed Max │  │
│  │ 20.5¢   │ 25.3¢   │ 35.8¢   │ -2.1¢   │ 3.5¢    │ 15.2¢   │  │
│  │ [GREEN] │ [WHITE] │ [RED]   │ [RED]   │ [WHITE] │ [GREEN] │  │
│  └─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘  │
│                                                                   │
│  📈 Chart Visualization                                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  35¢ ┌───────────────────────────────────────────────────┐ ││
│  │      │ ╱╲    ╱─────╲  ╱──────╲  Orange=Buy              │ ││
│  │  30¢ │╱  ╲  ╱       ╲╱        ╲                          │ ││
│  │      │    ╲╱                    ╲                        │ ││
│  │  25¢ │                          ╲ ╱─────────────────────┤ ││
│  │  20¢ │                           ╲╱                  ╲──┤ ││
│  │      │                                            ╱─╱   │ ││
│  │  15¢ │ ─────────────────────────────────────────╱      │ ││
│  │      │        ╱╲                  ╱╲        ╱─╱        │ ││
│  │  10¢ │       ╱  ╲                ╱  ╲──────╱          │ ││
│  │      │      ╱    ╲              ╱                      │ ││
│  │   5¢ │     ╱      ╲────────────╱                       │ ││
│  │   0¢ │────╱                                            │ ││
│  │      │            Blue=Feed-in                         │ ││
│  │ -5¢  │ ──────────────────────────────────────────────────┤ ││
│  │      └─────────────────────────────────────────────────┘ ││
│  │    0:00  4:00  8:00  12:00  16:00  20:00  24:00        ││
│  │                        Time                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                   │
│  ℹ️ Status: ✓ Loaded 336 price intervals                        │
│     Updated: Dec 5, 2025 3:45:22 PM                             │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Color Coding System

### Statistics Panel
```
Buy Prices:
  🟢 Green (Min)   = Good time to buy (cheap electricity)
  ⚪ White (Avg)   = Average cost
  🔴 Red (Max)     = Expensive time to buy (avoid if possible)

Feed-in Prices:
  🔴 Red (Min)     = Poor earnings (avoid exporting)
  ⚪ White (Avg)   = Average earnings
  🟢 Green (Max)   = Excellent earnings (export if possible)
```

### Chart Lines
```
🟠 Orange Line   = Buy Price (what you PAY to import)
                   Higher = more expensive
                   Lower = cheaper

🔵 Blue Line     = Feed-in Price (what you EARN from export)
                   Positive = you earn money
                   Negative = you pay (rare)
                   Higher = better earnings
```

## Workflow

```
1. User navigates to History & Reports page
   ↓
2. Date pickers auto-populate with defaults (last 7 days)
   ↓
3. User can optionally change date range or resolution
   ↓
4. User clicks "📈 Fetch Prices" button
   ↓
5. System validates date range
   ├─ If invalid: Show error message → Back to step 3
   └─ If valid: Continue to step 6
   ↓
6. Button changes to "⏳ Loading prices..."
   ↓
7. Fetch Amber sites
   ├─ If error: Show "No Amber sites" error
   └─ If success: Continue to step 8
   ↓
8. Fetch historical prices from API
   ├─ If error: Show error message
   └─ If success: Continue to step 9
   ↓
9. Process and display data:
   - Calculate statistics (min/max/avg)
   - Show statistics panel
   - Render chart with both price lines
   - Display timestamp
   ↓
10. Show success message
    ↓
11. User can analyze the chart:
    - Hover over points to see exact values
    - Identify patterns and trends
    - Use insights for automation decisions
```

## Validation Rules Reference

```
Start Date:
  ✓ Required (must not be empty)
  ✓ Must be ≤ today
  ✓ Must be before End Date
  ✓ Format: YYYY-MM-DD (HTML5 picker enforces)

End Date:
  ✓ Required (must not be empty)
  ✓ Must be ≤ today
  ✓ Must be ≥ Start Date
  ✓ Format: YYYY-MM-DD (HTML5 picker enforces)

Date Range:
  ✓ Maximum 90 days
  ⚠️ Warning if > 14 days (may take longer to load)
  ✓ Validates inclusive of start and end dates

Resolution:
  5-minute:   More detail, higher data volume
  30-minute:  Balanced (recommended for >7 days)
```

## Error Messages & Solutions

```
"Start date must be before end date"
→ Click "Start Date" and select an earlier date

"End date cannot be in the future"
→ Click "End Date" and select today or earlier

"Maximum range is 90 days (you selected X days)"
→ Select a smaller date range (≤ 90 days)

"Start date is required"
→ Click "Start Date" picker and select a date

"End date is required"
→ Click "End Date" picker and select a date

"No Amber sites available. Please configure your Amber API key in settings."
→ Go to Settings and add your Amber API key

"Request timeout"
→ Your connection may be slow, try a smaller range

"Failed to fetch prices: [error detail]"
→ Check your internet connection and try again
```

## Data Interpretation Examples

### Example 1: Buy Price Pattern
```
Time    Price    Meaning
6:00    35¢      Expensive (peak demand evening)
9:00    28¢      Moderate (morning shoulder)
12:00   22¢      Cheap (midday solar abundance)
15:00   20¢      Cheapest (peak solar generation)
18:00   38¢      Very expensive (peak demand, no solar)
```
→ Action: Charge battery between 12:00-15:00 when prices are low

### Example 2: Feed-in Price Pattern
```
Time    Price    Meaning
6:00    -5¢      You pay to export (poor)
12:00   12¢      You earn 12¢/kWh (good)
15:00   15¢      You earn 15¢/kWh (excellent)
18:00   2¢       You earn 2¢/kWh (fair)
```
→ Action: Export battery power between 12:00-15:00 for best returns

### Example 3: Demand Response
```
Market Condition           Recommendation
Low buy, high feed-in     Export all available power
High buy, low feed-in     Import from battery, avoid grid
Both high                 Export if have excess
Both low                  Flexible - either option okay
```

## Keyboard Shortcuts

```
Ctrl/Cmd + R     Refresh the page (browser refresh)
Tab              Navigate between date inputs
Enter            Submit form (if date picker open)
Esc              Close any open dialogs
```

## Mobile Tips

- Date pickers work on mobile with native date selector
- Chart is fully responsive and touch-friendly
- Tap legend items to toggle lines on/off
- Tap and hold on chart for detailed hover info (depending on browser)
- Use 30-minute resolution for better mobile performance

## Performance Tips

- ✓ Use 30-minute resolution (not 5-minute) for ranges >7 days
- ✓ Query smaller ranges for faster loading
- ✓ Use browser back button to retry failed requests
- ✓ Clear browser cache if chart displays incorrectly
- ✓ Close other tabs for better chart rendering performance

## FAQ

**Q: How often is the data updated?**
A: Historical data is accurate as of when the API was last called. Current day data updates in real-time via the main dashboard.

**Q: Can I see data from more than 90 days ago?**
A: The 90-day limit is enforced for API stability. You can make multiple queries to see longer periods.

**Q: Why are feed-in prices sometimes negative?**
A: Negative means the grid operator is paying you to not export (rare, during low demand). The app displays these as negative values.

**Q: What timezone is used?**
A: All times are displayed in Australia/Sydney timezone (AEST/AEDT).

**Q: Can I export this data?**
A: Currently exports not supported, but you can take screenshots. CSV export planned for future release.

**Q: Why does the chart sometimes show gaps?**
A: This happens when data is not available for certain intervals (rare). It usually indicates an issue with the API data.

## Troubleshooting Quick Links

- Documentation: See AMBER_HISTORICAL_PRICES.md
- Technical Details: See IMPLEMENTATION_SUMMARY.md
- Deployment Info: See DEPLOYMENT_CHECKLIST.md
- Settings Page: Configure Amber API key
- Home Page: View current prices and status
