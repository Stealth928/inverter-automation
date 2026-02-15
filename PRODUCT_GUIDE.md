# Inverter Automation: Smart Solar & Battery Management Platform
**Your Personal Energy Manager — Maximize Savings, Minimize Effort**

---

## What Is Inverter Automation?

Inverter Automation is an intelligent energy management platform that automatically controls your solar inverter and battery system to maximize your savings and minimize your grid costs. 

Think of it as having a 24/7 energy expert watching electricity prices, weather forecasts, and your battery levels—then making the smartest decisions about when to charge, discharge, or store your energy.

**The result?** You save hundreds to thousands of dollars per year without lifting a finger.

---

## Who Is This For?

✅ **Solar + Battery Owners** with FoxESS inverters who want to optimize energy usage  
✅ **Amber Electric Customers** who experience volatile wholesale electricity prices  
✅ **Energy Enthusiasts** who want complete control over their home energy system  
✅ **Cost-Conscious Households** looking to maximize ROI from their solar investment  
✅ **Tech-Savvy Users** who want automation without managing servers or infrastructure  

**Not a programmer?** No problem. The interface is designed for homeowners, not developers.

---

## Why Choose Inverter Automation?

### 🎯 **Set It and Forget It**
Create your automation rules once. The system runs 24/7 in the cloud, making split-second decisions even when you're asleep, at work, or on vacation.

### 💰 **Maximize Savings**
- **Export during price spikes** — Automatically sell your stored energy when grid prices surge (often earning 30-50¢/kWh or more)
- **Charge during off-peak** — Fill your battery when electricity is cheapest (sometimes negative pricing!)
- **Avoid peak rates** — Never buy expensive grid power when your battery can cover you

### 🔮 **Predictive Intelligence**
Don't just react to current prices—the system looks ahead 15, 30, or 60 minutes to anticipate price changes and weather patterns, optimizing for the best outcome.

### ⚡ **Instant Response**
When electricity prices spike within seconds (common with Amber Electric), your system responds immediately—no manual intervention required.

### 📊 **Full Transparency**
See exactly what your automation is doing: which rules triggered, why, and how much you saved. Every decision is logged and explained.

### 🔒 **Secure & Private**
Your data stays private. Industry-standard authentication protects your account. Your inverter credentials are encrypted and isolated.

---

## Core Features

### 1. **Smart Automation Rules**
Create custom rules that tell your system exactly how to behave under different conditions.

**Example Rules:**
- "When feed-in price exceeds 40¢/kWh and battery is above 80%, discharge at 5kW for 30 minutes"
- "If buy price drops below 5¢/kWh, charge battery to 100% from the grid"
- "Between 11am-2pm on sunny days, prioritize self-consumption"

**What You Can Control:**
- **When:** Time windows, price thresholds, battery levels
- **How:** Charge rate, discharge rate, duration
- **Why:** Multiple conditions combined with AND/OR logic

### 2. **Quick Control Mode**
Need to override automation for a specific situation? Quick Control gives you instant manual control without disabling your rules.

**Use Cases:**
- "Force charge my battery now because a storm is coming"
- "Discharge everything before a price spike I know is coming"
- "Override automation for 2 hours while I test something"

**Features:**
- Set custom power levels (0-10,000W)
- Choose duration (2 minutes to 6 hours)
- Automatic cleanup when timer expires
- Countdown timer shows remaining time

### 3. **Solar Curtailment Protection**
When feed-in prices go negative (you pay to export), the system can automatically reduce your solar production to avoid losing money.

**How It Helps:**
- Detects negative pricing events
- Reduces inverter output to match your home consumption
- Prevents you from paying to export solar energy
- Automatically resumes normal operation when prices recover

**Safety First:** Discovery mode lets you test settings safely before enabling automation.

### 4. **Price Intelligence (Amber Integration)**
Real-time and forecast pricing data powers your automation.

**What You Get:**
- Current buy and feed-in prices (updated every 5 minutes)
- 30-minute rolling forecasts
- Price spike detection
- Historical price tracking

**Perfect For:** Amber Electric customers who want to capitalize on wholesale pricing volatility.

### 5. **Weather-Aware Optimization**
Your system considers weather conditions to make smarter decisions.

**Weather Data:**
- Current and forecast solar radiation
- Cloud cover predictions
- Temperature monitoring (ambient, battery, inverter)
- 7-day forecasts for planning

**Example:** "If tomorrow is cloudy, charge the battery tonight while prices are low."

### 6. **Blackout Windows**
Define times when automation should pause—no questions asked.

**Common Uses:**
- "Don't discharge between 6-9pm when we're cooking dinner"
- "Pause automation during peak demand charges"
- "Leave battery alone on weekends when we're home"

**Flexibility:** Set different windows for different days of the week.

### 7. **Multi-User Support**
Each household gets their own secure, isolated account.

**What This Means:**
- Your data and settings are completely private
- Multiple family members can have different access levels
- No interference between different users or systems
- Scale from one home to hundreds of installations

### 8. **Tesla Powerwall Integration** *(Advanced)*
Control your Tesla Powerwall alongside your FoxESS inverter.

**Requirements:** Tesla Fleet API access, cryptographic key setup  
**Capabilities:** Charge control, discharge management, SOC targeting  
**Status:** Fully functional with signed command support  

### 9. **Comprehensive History & Analytics**
Track every automation decision and measure your savings.

**Available Reports:**
- Automation triggers (which rules fired and when)
- Manual control events
- Quick control sessions
- Rule changes and configuration updates
- ROI calculator (track your savings over time)

**Visibility:** Understand exactly how automation is helping you save.

### 10. **Return on Investment (ROI) Tracking**
See how much money automation has saved you.

**Metrics Tracked:**
- Grid import savings (charging at low prices)
- Export revenue gains (selling at high prices)
- Avoided costs (not buying expensive peak power)
- System efficiency improvements

**Timeline:** View savings by day, week, month, or year.

---

## How It Works (Simple 5-Step Flow)

### Step 1: **Sign Up**
Create your account using secure email/password authentication. Your account is isolated and private.

### Step 2: **Connect Your Systems**
Enter your API credentials (we'll guide you through getting these):
- FoxESS Cloud account token
- Amber Electric API key
- Tesla credentials (optional)

**Don't worry—** These are stored securely and never shared.

### Step 3: **Create Your Rules**
Use our rule builder to define your automation strategy:
1. Choose conditions (price, battery level, weather, time)
2. Set thresholds (e.g., "when price > 30¢/kWh")
3. Define actions (charge, discharge, wait)
4. Prioritize rules (which runs first)

**Templates Available:** Start with proven rules and customize to your needs.

### Step 4: **Enable Automation**
Flip the switch. Your rules are now running in the cloud 24/7.

**Behind the Scenes:**
- System checks conditions every minute
- Fetches live prices, weather, and battery data
- Evaluates your rules in priority order
- Automatically adjusts your inverter settings
- Logs every decision for transparency

### Step 5: **Monitor & Optimize**
Watch the dashboard to see automation in action:
- Live status updates
- Rule trigger notifications
- Savings calculations
- Performance metrics

**Refine Over Time:** Adjust rules based on results and seasonal patterns.

---

## Real-World Use Cases

### 📈 **Case 1: Price Spike Capitalizer**
**Scenario:** Amber prices spike to 80¢/kWh during a summer heatwave peak.

**What Automation Does:**
1. Detects price spike within 60 seconds
2. Triggers "High Feed-in Export" rule
3. Discharges battery at 5kW for 30 minutes
4. Earns $2.40 from that single event
5. Repeats every time prices spike

**Annual Impact:** 50+ spike events = $100-300 extra revenue per year

---

### ⚡ **Case 2: Overnight Supercharger**
**Scenario:** Off-peak grid prices drop to 2¢/kWh between 1-4am.

**What Automation Does:**
1. Detects cheap overnight rate
2. Triggers "Cheap Night Charge" rule
3. Charges 10kWh battery from grid for $0.20
4. Uses that stored energy during the day when prices average 25¢/kWh
5. Saves $2.30 per day

**Annual Impact:** $840+ in avoided daytime grid purchases

---

### 🌧️ **Case 3: Cloudy Day Protector**
**Scenario:** Weather forecast shows overcast conditions tomorrow, but tonight's prices are reasonable.

**What Automation Does:**
1. Checks tomorrow's solar radiation forecast
2. Detects low solar production expected
3. Triggers "Pre-charge Before Bad Weather" rule
4. Tops up battery to 100% overnight
5. Avoids expensive grid power tomorrow during cloudy weather

**Annual Impact:** 40+ cloudy days = $200-400 saved

---

### 🚫 **Case 4: Negative Pricing Navigator**
**Scenario:** Feed-in price goes negative (you pay to export) due to grid oversupply.

**What Automation Does:**
1. Detects negative pricing event
2. Activates solar curtailment
3. Reduces inverter output to match home consumption only
4. Prevents exporting (which would cost you money)
5. Resumes normal operation when prices recover

**Annual Impact:** 20+ negative pricing events = $50-150 saved

---

### ⏰ **Case 5: Peak Avoidance Pro**
**Scenario:** You're on a time-of-use plan with 45¢/kWh peak rates from 5-9pm.

**What Automation Does:**
1. Triggers "Peak Time Shield" rule at 5pm
2. Switches to battery power for household consumption
3. Avoids any grid imports during expensive window
4. Saves 3kWh × 45¢ = $1.35 per day

**Annual Impact:** $495 saved annually

---

## Understanding Automation Conditions

### **Price Conditions**
- **Current Feed-in Price** — What you earn for exporting right now
- **Current Buy Price** — What you pay for importing right now
- **Forecast Price** — What prices will be in 15/30/60 minutes
- **Price Trends** — Is price rising, falling, or stable?

### **Battery Conditions**
- **State of Charge (SOC)** — Current battery level (0-100%)
- **Battery Temperature** — Monitors for safety and efficiency
- **Remaining Capacity** — How much energy is available

### **Weather Conditions**
- **Solar Radiation** — Current and forecast sunshine intensity
- **Cloud Cover** — Percent cloud coverage (affects solar production)
- **Temperature** — Ambient, inverter, and battery temps

### **Time Conditions**
- **Time Windows** — Specific hours/days when rules apply
- **Day of Week** — Weekday vs weekend behavior
- **Seasonal** — Combine time with weather for seasonal optimization

### **Combining Conditions**
Rules can have multiple conditions that ALL must be true (AND logic):
- "Feed-in price > 35¢ **AND** battery SOC > 85% **AND** time is 12-6pm"

---

## Automation Actions (What Your System Can Do)

### 🔋 **ForceCharge**
Pull power from the grid to charge your battery.

**When to Use:**
- Overnight off-peak rates
- Negative pricing events
- Pre-charging before expected high prices

**Settings:**
- Charge power (watts)
- Target SOC (%)
- Duration (minutes)

---

### ⚡ **ForceDischarge**
Push stored battery energy to the grid or your home.

**When to Use:**
- Price spike events
- Peak rate avoidance
- Maximizing feed-in revenue

**Settings:**
- Discharge power (5000W typical)
- Stop SOC (minimum battery level)
- Duration (15-60 minutes)

---

### 🏠 **SelfUse**
Prioritize powering your home from solar and battery, minimize grid interaction.

**When to Use:**
- Normal daytime operation
- When prices are moderate
- Default "do nothing special" mode

**Benefits:**
- Maximizes self-consumption
- Reduces bill without aggressive trading
- Preserves battery for later

---

### 🛡️ **Backup**
Preserve battery charge for emergency backup power.

**When to Use:**
- Storm warnings
- Grid instability events
- You need guaranteed backup capacity

**Behavior:**
- Prevents discharge below threshold
- Prioritizes battery preservation
- Charges from solar only

---

## Dashboard Overview

### **Main Dashboard (index.html)**
Your command center for everything automation.

**Live Status Section:**
- Current automation status (enabled/disabled)
- Active rule display (which rule is running now)
- Last check timestamp (when system last evaluated rules)
- Quick enable/disable toggle

**Price Intelligence:**
- Current Amber buy price (what you pay)
- Current feed-in price (what you earn)
- 30-minute price forecast
- Price trend indicators (↑ ↓ →)

**Battery Health:**
- Current state of charge (%)
- Battery temperature
- Estimated capacity (kWh)
- Charge/discharge status

**Weather Overview:**
- Current solar radiation
- Cloud cover forecast
- Temperature monitoring
- 7-day solar outlook

**Quick Control Panel:**
- Start manual override
- Set custom power and duration
- Live countdown timer
- One-click stop button

**Rule Management:**
- View all rules
- Enable/disable individual rules
- Edit rule conditions
- Reorder priorities
- Add new rules

**Recent Activity Feed:**
- Last 10 automation triggers
- Which rule fired and why
- Actions taken
- Outcomes and results

---

### **Settings Page**
Configure your system and integrations.

**API Credentials:**
- FoxESS account token
- Amber API key
- Tesla credentials (optional)
- Validation and testing tools

**Automation Configuration:**
- Default check interval (1 minute recommended)
- Global automation enable/disable
- Blackout windows setup
- Safety thresholds

**Device Settings:**
- Inverter serial number
- Battery capacity
- System timezone
- Location settings

**User Profile:**
- Email and password management
- Account security
- Notification preferences
- Data export options

---

### **History Page**
Review past automation decisions and performance.

**Filters:**
- Date range selector
- Event type (automation, quick control, manual)
- Rule name
- Export to CSV

**Event Details:**
- Timestamp
- Rule triggered
- Conditions that were met
- Action taken
- Price at trigger time
- Estimated savings

**Analytics Charts:**
- Triggers per day
- Most active rules
- Average savings per trigger
- System uptime

---

### **ROI Calculator**
Measure your automation's financial impact.

**Savings Breakdown:**
- Grid import avoided (charging at low prices vs buying at high prices)
- Export revenue gains (selling at optimal times vs average)
- Peak avoidance savings (using battery instead of expensive grid power)
- Total cumulative savings

**Time Periods:**
- Today
- Last 7 days
- Last 30 days
- Last 12 months
- Custom date range

**Projections:**
- Estimated annual savings
- Payback period on battery investment
- ROI percentage

---

### **Solar Curtailment Page** *(Advanced)*
Discovery and testing interface for solar production control.

**Discovery Sections:**
1. Current device settings (read-only exploration)
2. Inverter capabilities and limits
3. Safe test environment
4. Real-time activity logging
5. Configuration examples
6. Curtailment rule builder

**Safety Features:**
- Read-only mode by default
- Explicit confirmation required for changes
- One-click restore to defaults
- Activity audit trail

---

### **Tesla Integration Page** *(Advanced)*
Connect and control your Tesla Powerwall or vehicle.

**Setup Wizard:**
- Generate cryptographic keys
- Register public key with Tesla
- Test connection
- Configure charge/discharge parameters

**Control Options:**
- Coordinate with FoxESS automation
- Set Powerwall charge/discharge schedule
- Vehicle charging optimization (if applicable)
- Combined system efficiency

---

## Getting Started in 15 Minutes

### **Minute 1-3: Create Account**
1. Visit your deployment URL
2. Click "Sign Up"
3. Enter email and password
4. Verify email (check inbox)

### **Minute 4-7: Connect FoxESS**
1. Log into [FoxESS Cloud](https://www.foxesscloud.com)
2. Go to Account Settings → API Management
3. Generate new API token
4. Copy token
5. Paste into Inverter Automation Settings page
6. Click "Validate" to test connection
7. Enter your device serial number

### **Minute 8-10: Connect Amber**
1. Log into [Amber Electric](https://app.amber.com.au)
2. Go to Account → API Access
3. Generate API key
4. Copy key
5. Paste into Inverter Automation Settings page
6. Click "Test Connection"

### **Minute 11-13: Create Your First Rule**
1. Go to Dashboard → Rules section
2. Click "Add New Rule"
3. Use template: "High Feed-in Export"
4. Set condition: Feed-in price > 35¢/kWh
5. Set condition: Battery SOC > 80%
6. Set action: ForceDischarge, 5000W, 30 minutes
7. Save rule

### **Minute 14-15: Enable Automation**
1. Click "Enable Automation" toggle
2. Watch the dashboard for first rule evaluation
3. Check activity feed for results

**You're done!** Automation is now running 24/7.

---

## Advanced Features

### **Rule Priority System**
When multiple rules' conditions are met simultaneously, priority determines which one runs.

**How It Works:**
- Rules have priority 1-10 (1 = highest)
- System evaluates all rules every cycle
- First rule in priority order with TRUE conditions wins
- That rule's action is applied
- Other rules wait for next cycle

**Example Scenario:**
- Rule A (Priority 1): "Emergency Backup" — Always preserve 50% SOC
- Rule B (Priority 2): "Price Spike Export" — Discharge if price > 50¢
- Rule C (Priority 3): "Normal SelfUse" — Default behavior

If battery is at 60% and price hits 55¢/kWh:
- Rule B triggers (high priority, conditions met)
- Rule C is skipped (lower priority)
- Rule A would override everything if SOC dropped below 50%

**Best Practice:** Put safety rules at Priority 1, money-making rules at 2-5, default behavior at 10.

---

### **Cooldown Periods**
Prevent rules from triggering too frequently.

**Why Needed:**
- Avoid wearing out inverter relays
- Prevent thrashing during volatile prices
- Ensure actions have time to complete

**Setting Cooldown:**
- Each rule has `cooldownMinutes` parameter
- System tracks when rule last fired
- Rule cannot trigger again until cooldown expires

**Example:** "High Feed-in Export" with 15-minute cooldown:
- Triggers at 2:00pm when price hits 45¢/kWh
- Cannot trigger again until 2:15pm, even if price stays high
- Prevents repeated segment creation for same event

---

### **Forecast-Based Optimization**
Look ahead 15-60 minutes to make smarter decisions.

**Use Cases:**

**1. Price Ramp Detection**
"Current price is 25¢, but forecast shows 50¢ in 30 minutes"
- Don't discharge now at 25¢
- Wait for higher price
- Rule condition: `forecastPrice.30min > 45¢`

**2. Weather Prep**
"Clear now, but forecast shows clouds in 60 minutes"
- Charge battery while solar is strong
- Prepare for reduced production
- Rule condition: `solarRadiation.60min < 200 W/m²`

**3. Peak Avoidance**
"Cheap now, but peak rates start in 15 minutes"
- Charge battery immediately
- Avoid expensive peak imports later
- Rule condition: `buyPrice.15min > 40¢`

---

### **Segment Duration Strategy**
How long should your automation actions last?

**Short Duration (15-30 min):**
- **Pros:** Responsive to changing conditions, lower risk
- **Cons:** More frequent inverter changes
- **Best for:** Volatile pricing, frequent rule changes

**Medium Duration (30-60 min):**
- **Pros:** Balance of responsiveness and stability
- **Cons:** May miss short price spikes
- **Best for:** Most users, general automation

**Long Duration (60-180 min):**
- **Pros:** Fewer inverter switches, stable operation
- **Cons:** Less responsive to changes, higher risk if conditions change
- **Best for:** Overnight charging, predictable patterns

**Best Practice:** Start with 30 minutes, adjust based on price volatility in your area.

---

### **Combining Multiple Conditions**
Build sophisticated rules by requiring multiple conditions.

**Example: "Smart Export Pro"**
```javascript
{
  name: "Smart Export Pro",
  priority: 2,
  conditions: {
    feedInPrice: { enabled: true, operator: '>', value: 35 },
    soc: { enabled: true, operator: '>', value: 85 },
    time: { enabled: true, startTime: '10:00', endTime: '18:00' },
    solarRadiation: { enabled: true, operator: '>', value: 300 }
  },
  action: {
    workMode: "ForceDischarge",
    durationMinutes: 30,
    fdPwr: 5000,
    fdSoc: 20
  }
}
```

**This rule only triggers when ALL of these are true:**
- Feed-in price exceeds 35¢/kWh (good export revenue)
- Battery is above 85% (plenty to spare)
- Time is between 10am-6pm (solar production hours)
- Solar radiation is strong (battery will refill)

**Result:** Maximum safety and profitability.

---

## Safety Features

### **1. Automatic Safety Limits**
- Minimum battery SOC enforcement (prevent deep discharge)
- Maximum charge rate limits (protect battery health)
- Temperature monitoring (pause if overheating)
- Grid connection verification (don't discharge if offline)

### **2. User-Defined Boundaries**
- Set your own minimum SOC threshold
- Define maximum discharge power
- Configure charge rate limits
- Establish off-limit time windows

### **3. Conflict Prevention**
- Quick Control overrides automation (manual always wins)
- Only one rule can be active at a time
- Cooldown periods prevent rapid switching
- State validation before every action

### **4. Fail-Safe Defaults**
- If API call fails, system defaults to SelfUse mode
- Lost connection triggers safe fallback
- Authentication errors pause automation (not disable permanently)
- Logs all errors for troubleshooting

### **5. Audit Trail**
- Every automation decision is logged
- History page shows exactly what happened and why
- Export logs for analysis or support
- Timestamps and conditions preserved

---

## Frequently Asked Questions

### **General Questions**

**Q: Do I need to be a programmer to use this?**  
A: No. The interface is designed for homeowners. If you can use online banking, you can use this.

**Q: Will this void my inverter warranty?**  
A: No. The system uses official FoxESS Cloud APIs—the same interface FoxESS's own app uses.

**Q: What if I want to disable automation temporarily?**  
A: One click on the dashboard toggle pauses automation. Click again to resume.

**Q: Can I control my inverter manually while automation is enabled?**  
A: Yes. Use Quick Control mode for manual overrides. Automation resumes when your override expires.

**Q: What happens if my internet goes down?**  
A: Your inverter continues operating in its last mode until connection is restored. No damage or data loss.

---

### **Technical Questions**

**Q: How often does the system check conditions?**  
A: Every 1 minute by default. You can adjust this in settings.

**Q: What's the response time to price spikes?**  
A: Typically 60-90 seconds from price update to inverter adjustment.

**Q: Does this work with other inverter brands?**  
A: Currently FoxESS only. Other brands may be added based on demand.

**Q: Can I use this without Amber Electric?**  
A: Yes, but price-based automation won't work. Weather and time-based rules still function.

**Q: Is my data backed up?**  
A: Yes. All data is stored in Google Cloud Firestore with automatic replication and backups.

---

### **Cost & Savings Questions**

**Q: How much can I realistically save?**  
A: Depends on your battery size, electricity usage, and price volatility. Typical users report $500-$2000/year in additional savings compared to no automation.

**Q: What's the payback period?**  
A: If you already have solar + battery: immediate (no hardware cost). For new installations: automation can reduce battery payback from 7-10 years to 5-7 years.

**Q: Are there any ongoing costs?**  
A: Firebase hosting and Cloud Functions have very low costs (typically $1-10/month depending on usage). We'll provide cost estimates based on your usage.

**Q: Can I measure exactly how much I've saved?**  
A: Yes. The ROI calculator estimates savings based on avoided costs and export revenue. Track daily, weekly, monthly, or yearly.

---

### **Support Questions**

**Q: What if something goes wrong?**  
A: Check the History page for error logs. Common issues (connection failures, API errors) are logged with suggestions. Contact support if needed.

**Q: Can I see what the system will do before enabling automation?**  
A: Yes. Enable "Preview Mode" to see which rules would trigger without actually taking action.

**Q: How do I know if automation is working?**  
A: The dashboard shows "Last Check" timestamp (should update every minute) and "Active Rule" (which rule is running). The Activity Feed shows recent triggers.

**Q: Can I undo an automation action?**  
A: Yes. Use Quick Control to immediately override, or adjust rules and they'll apply within 1 minute.

---

## Best Practices & Tips

### **Rule Design Tips**

1. **Start Simple**
   - Begin with 2-3 basic rules
   - Add complexity after observing behavior
   - Test new rules during low-risk times

2. **Use Conservative Thresholds**
   - Don't discharge below 30% SOC (battery health)
   - Leave buffer capacity for unexpected needs
   - Set realistic power levels (don't max out inverter)

3. **Prioritize Safety**
   - Always have a backup preservation rule at Priority 1
   - Set reasonable cooldown periods (15-30 min)
   - Use time windows to avoid problematic hours

4. **Monitor and Adjust**
   - Review History page weekly
   - Identify rules that never trigger (remove or adjust)
   - Fine-tune thresholds based on results

5. **Seasonal Optimization**
   - Summer: More aggressive discharge (strong solar refill)
   - Winter: Conservative discharge (limited solar)
   - Adjust thresholds quarterly

---

### **Cost Optimization Tips**

1. **Target Extreme Prices**
   - Focus on top 10% price events (highest returns)
   - Don't trade for small margins (<5¢ difference)
   - Let normal times run in SelfUse mode

2. **Overnight Charging Strategy**
   - Charge when prices are lowest (usually 1-4am)
   - Look for negative pricing events (you get paid to charge!)
   - Pre-charge before expected high-price days

3. **Export Timing**
   - Discharge during peak demand (5-9pm typical)
   - Watch for price spikes during hot weather
   - Leave battery capacity for unexpected spikes

4. **Weather Intelligence**
   - Use weather forecasts to decide overnight charging
   - If tomorrow is sunny, don't top up tonight
   - If cloudy forecast, charge from grid while cheap

5. **Reduce Grid Interaction**
   - Maximize self-consumption during moderate prices
   - Only buy/sell when price differentials are large
   - Minimize battery cycling for health and efficiency

---

### **Battery Health Tips**

1. **Avoid Deep Discharge**
   - Never discharge below 10-15% SOC
   - Set rule-level minimums (fdSoc parameter)
   - Create backup preservation rule at Priority 1

2. **Limit Full Charges**
   - Charging to 100% daily reduces battery lifespan
   - Target 85-90% for most rules
   - Only go to 100% before known high-price events

3. **Temperature Management**
   - Pause automation if battery temp exceeds safe limits
   - Add temperature conditions to discharge rules
   - Monitor inverter temperature in hot weather

4. **Reduce Cycling**
   - Use cooldown periods to prevent rapid charge/discharge
   - Aim for 1-2 full cycles per day maximum
   - Let battery rest during moderate price periods

---

### **Troubleshooting Common Issues**

**Issue: Automation not triggering**
- ✅ Check that "Enabled" toggle is ON
- ✅ Verify API credentials are valid (test in Settings)
- ✅ Confirm rule conditions are possible to meet
- ✅ Check if inside blackout window
- ✅ Review cooldown period (rule may be temporarily locked)

**Issue: Rules triggering too often**
- ✅ Increase cooldown period (30+ minutes)
- ✅ Make conditions more restrictive (higher thresholds)
- ✅ Add time window to limit active hours
- ✅ Check for overlapping rules (disable duplicates)

**Issue: Prices not updating**
- ✅ Verify Amber API key is correct
- ✅ Check Amber account is active
- ✅ Confirm site ID is correct in settings
- ✅ View console logs for API error messages

**Issue: Inverter not responding**
- ✅ Verify FoxESS token is valid (may expire)
- ✅ Check device serial number is correct
- ✅ Test connection in Settings page
- ✅ Confirm inverter is online in FoxESS app

**Issue: Quick Control not clearing**
- ✅ Refresh page to get latest status
- ✅ Manually stop if timer is stuck
- ✅ Check History page for auto-cleanup logs
- ✅ Restart automation if needed

---

## Roadmap & Future Features

### **Coming Soon**

🔜 **Mobile App**
- Native iOS and Android apps
- Push notifications for price spikes
- Quick control from your phone
- Voice assistant integration

🔜 **Advanced Analytics**
- Detailed cost/benefit analysis per rule
- Seasonal comparison charts
- Predictive savings projections
- Export data to Excel/Google Sheets

🔜 **AI-Powered Optimization**
- Machine learning from your usage patterns
- Automatic rule suggestions
- Adaptive thresholds based on market conditions
- Anomaly detection and alerts

🔜 **Community Features**
- Share rule templates with other users
- Browse top-performing strategies
- Regional optimization recommendations
- Community forums and tips

🔜 **Enhanced Integrations**
- Virtual Power Plant (VPP) participation
- Home Assistant integration
- IFTTT/Zapier webhooks
- Solar analytics platforms

🔜 **Multi-Device Support**
- Control multiple inverters from one account
- Cross-device optimization
- Load balancing across systems
- Family/household shared access

---

## Conclusion: Take Control of Your Energy

Inverter Automation puts you in the driver's seat of your home energy system. Whether you're looking to save hundreds of dollars per year, maximize your solar investment, or simply enjoy the peace of mind that comes with intelligent automation, this platform delivers.

**The best part?** It works 24/7, even when you're sleeping, at work, or on vacation. Set it once, let it run, and watch your savings grow.

**Ready to get started?**
1. Sign up for an account
2. Connect your systems (15 minutes)
3. Create your first rule (5 minutes)
4. Enable automation and relax

Your energy future is automated, optimized, and under your control.

---

## Support & Resources

**Documentation:**
- Technical API Reference: `docs/API.md`
- Automation Rules Deep Dive: `docs/AUTOMATION.md`
- Setup Instructions: `docs/SETUP.md`
- Testing Guide: `TESTING_GUIDE.md`

**Community:**
- GitHub Issues: Report bugs and request features
- Discussions: Share strategies and ask questions

**Contact:**
- Feature requests: Open a GitHub issue
- Bug reports: Check logs, then report
- General questions: Start a discussion thread

---

**Version:** 1.0  
**Last Updated:** February 15, 2026  
**Document Type:** Product Guide & User Manual

*Built with ❤️ for smart energy management*
