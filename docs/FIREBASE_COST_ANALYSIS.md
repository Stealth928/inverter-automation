# Firebase Running Costs Analysis
## Inverter Automation Project

**Report Date:** December 23, 2025  
**Analysis Period:** Monthly operating costs  
**Target User Scales:** 50, 100, 500, 1000 users

---

## Executive Summary

Firebase pricing is consumption-based. Costs depend on:
- **Firestore operations:** Read/Write/Delete
- **Cloud Functions:** Invocations and compute time
- **Authentication:** IAM operations (free tier generous)
- **Data egress:** Network bandwidth out
- **Cloud Storage:** If used (minimal in this project)

**Key Assumptions for Inverter Automation:**
- Automation runs every 1 minute per active user (scheduler)
- Each automation cycle: ~3-5 API calls (FoxESS, Amber, Weather)
- Settings management: 10 Firestore reads/week, 1 write/week per user
- Average session: 2 hours/week per active user
- Active users: ~80% of total registered users
- Daily active: ~30% of total registered users

---

## Firebase Pricing (as of Dec 2025)

### Firestore
| Operation | Cost |
|-----------|------|
| Read | $0.06 per 100,000 reads |
| Write | $0.18 per 100,000 writes |
| Delete | $0.02 per 100,000 deletes |
| Storage | $0.18 per GB-month |

### Cloud Functions
| Metric | Cost |
|--------|------|
| Invocations | $0.40 per million invocations |
| Compute (2nd Gen) | $0.00002500 per vCPU-second |
| Network egress | First 1GB free, $0.12 per GB after |

### Authentication
| Operation | Cost |
|-----------|------|
| User accounts | Free (generous free tier) |
| ID token generation | Free |
| Email/password sign-in | Free |

### Storage
| Metric | Cost |
|--------|------|
| Storage | $0.020 per GB-month |
| Operations | $0.0004 per 10K ops (read/write) |

---

## Usage Patterns Breakdown

### Per User, Per Day
| Operation | Frequency | Details |
|-----------|-----------|---------|
| Automation cycles | 1,440 | Every 1 minute × 24 hours |
| API calls (Firestore reads) per cycle | 5 | Check rules, device status, prices |
| API calls (external) per cycle | 3-4 | FoxESS (2), Amber (1), Weather (0-1) |
| Settings page visits | 0.2 | ~2 per week |
| Config reads on settings load | 15 | Per settings visit |
| Config writes | 0.1 | Weekly changes |

### Per User, Per Month
| Operation | Count | Cost Impact |
|-----------|-------|-------------|
| Automation Firestore reads | ~216,000 | 5 reads × 1,440 cycles × 30 days |
| Automation Firestore writes | ~1,440 | 1 write × 1 per automation cycle (if state changes) |
| Settings reads | ~90 | 15 reads × 0.2 visits/day × 30 days |
| Settings writes | ~3 | 0.1 writes/day × 30 days |
| Cloud Function invocations | 43,200 | 1 per minute × 1,440 min/day × 30 days |

---

## Cost Calculations by User Scale

### 50 Users (Small Deployment)

#### Monthly Firestore Costs
```
Automation reads:   50 users × 216,000 reads = 10,800,000 reads
Cost: 10,800,000 / 100,000 × $0.06 = $6,480

Automation writes:  50 users × 1,440 writes = 72,000 writes  
Cost: 72,000 / 100,000 × $0.18 = $0.13 (negligible)

Settings reads:     50 users × 90 reads = 4,500 reads
Cost: 4,500 / 100,000 × $0.06 = $0.03 (negligible)

Settings writes:    50 users × 3 writes = 150 writes
Cost: 150 / 100,000 × $0.18 = $0.00 (negligible)

Total Firestore: ~$6.48/month
```

#### Monthly Cloud Functions Costs
```
Invocations: 50 users × 43,200 invocations = 2,160,000
Cost: 2,160,000 / 1,000,000 × $0.40 = $0.86

Compute time: 2,160,000 invocations × 100ms avg = 216,000 seconds
Cost: 216,000 vCPU-seconds × $0.00002500 = $5.40

Total Functions: $0.86 + $5.40 = $6.26/month
```

#### Network Egress
```
FoxESS API responses: ~1KB per response × 2 per cycle × 1,440 = ~3MB/day
Amber API responses: ~2KB per response × 1 per cycle × 1,440 = ~2.8MB/day  
Weather API: ~10KB per response × 1 per day = ~10KB/day
Total: ~6MB/day × 30 = ~180MB/month (within free tier, $0)
```

#### **50 Users Monthly Total: ~$12.74**

---

### 100 Users (Growing Deployment)

#### Monthly Firestore Costs
```
Automation reads:   100 × 216,000 = 21,600,000 reads
Cost: 21,600,000 / 100,000 × $0.06 = $12.96

Automation writes:  100 × 1,440 = 144,000 writes
Cost: 144,000 / 100,000 × $0.18 = $0.26

Settings operations: Negligible (~$0.06)

Total Firestore: ~$13.28/month
```

#### Monthly Cloud Functions Costs
```
Invocations: 100 × 43,200 = 4,320,000
Cost: 4,320,000 / 1,000,000 × $0.40 = $1.73

Compute: 4,320,000 × 100ms = 432,000 vCPU-seconds
Cost: 432,000 × $0.00002500 = $10.80

Total Functions: $12.53/month
```

#### **100 Users Monthly Total: ~$25.81**

---

### 500 Users (Medium Deployment)

#### Monthly Firestore Costs
```
Automation reads:   500 × 216,000 = 108,000,000 reads
Cost: 108,000,000 / 100,000 × $0.06 = $64.80

Automation writes:  500 × 1,440 = 720,000 writes
Cost: 720,000 / 100,000 × $0.18 = $1.30

Settings operations: ~$0.30

Total Firestore: ~$66.40/month
```

#### Monthly Cloud Functions Costs
```
Invocations: 500 × 43,200 = 21,600,000
Cost: 21,600,000 / 1,000,000 × $0.40 = $8.64

Compute: 21,600,000 × 100ms = 2,160,000 vCPU-seconds
Cost: 2,160,000 × $0.00002500 = $54.00

Total Functions: $62.64/month
```

#### Network Egress
```
Data out: ~900MB/month (within free tier, $0)
```

#### **500 Users Monthly Total: ~$129.04**

---

### 1000 Users (Large Deployment)

#### Monthly Firestore Costs
```
Automation reads:   1000 × 216,000 = 216,000,000 reads
Cost: 216,000,000 / 100,000 × $0.06 = $129.60

Automation writes:  1000 × 1,440 = 1,440,000 writes
Cost: 1,440,000 / 100,000 × $0.18 = $2.59

Settings operations: ~$0.61

Total Firestore: ~$132.80/month
```

#### Monthly Cloud Functions Costs
```
Invocations: 1000 × 43,200 = 43,200,000
Cost: 43,200,000 / 1,000,000 × $0.40 = $17.28

Compute: 43,200,000 × 100ms = 4,320,000 vCPU-seconds
Cost: 4,320,000 × $0.00002500 = $108.00

Total Functions: $125.28/month
```

#### Network Egress
```
Data out: ~1.8GB/month
Free tier: 1GB free
Excess: 0.8GB × $0.12 = $0.096
```

#### **1000 Users Monthly Total: ~$258.18**

---

## Cost Summary Table

| User Count | Firestore | Functions | Egress | Total/Month | Per User/Month |
|------------|-----------|-----------|--------|-------------|----------------|
| 50 | $6.48 | $6.26 | $0.00 | **$12.74** | **$0.25** |
| 100 | $13.28 | $12.53 | $0.00 | **$25.81** | **$0.26** |
| 500 | $66.40 | $62.64 | $0.00 | **$129.04** | **$0.26** |
| 1000 | $132.80 | $125.28 | $0.10 | **$258.18** | **$0.26** |

### Key Insight
**Per-user cost stabilizes at ~$0.25-$0.26/month** due to the per-minute automation cycle and predictable Firestore access patterns.

---

## Cost Optimization Opportunities

### 1. **Reduce Automation Frequency** (HIGHEST IMPACT)
**Current:** Every 1 minute (1,440 cycles/day)  
**Option A:** Every 5 minutes → 75% cost reduction
- Saves 1,080 cycles/day
- Still monitors every 5 minutes ✓

**Estimated Savings:**
- 500 users: $96.78/month (75% of $129.04)
- 1000 users: $193.63/month (75% of $258.18)

### 2. **Cache Firestore Reads** (MEDIUM IMPACT)
**Current:** 5 Firestore reads per cycle  
**Optimization:** Cache device status for 5 minutes
- Reduce reads from 216K to ~43K per user per month
- ~80% reduction in Firestore costs

**Estimated Savings:**
- 500 users: $53.12/month
- 1000 users: $106.24/month

### 3. **Batch External API Calls** (LOW-MEDIUM IMPACT)
**Current:** Individual calls per cycle  
**Optimization:** Batch 5-minute worth of requests
- Reduces FoxESS API invocations
- Better rate-limiting compliance

**Estimated Savings:**
- 500 users: ~$10/month
- 1000 users: ~$20/month

### 4. **Archive Old Automation History** (LOW IMPACT)
**Current:** Store all history in Firestore  
**Optimization:** Move to Cloud Storage after 90 days
- Storage cost: $0.02/GB-month (vs $0.18 for Firestore index)
- Reduces Firestore storage index size

**Estimated Savings:**
- Per 1000 users: ~$5-10/month

---

## Scaling Economics

### Cost Per User Analysis
```
50 users:    $12.74/month = $0.255 per user
100 users:   $25.81/month = $0.258 per user
500 users:   $129.04/month = $0.258 per user
1000 users:  $258.18/month = $0.258 per user
```

### Annual Costs
| Users | Monthly | Annual |
|-------|---------|--------|
| 50 | $12.74 | $152.88 |
| 100 | $25.81 | $309.72 |
| 500 | $129.04 | $1,548.48 |
| 1000 | $258.18 | $3,098.16 |

### Pricing Model Recommendation
- **Free tier:** Up to 50 users (cost absorbed)
- **Starter plan:** $5/month (50-500 users, covers costs + margin)
- **Professional plan:** $15/month (500+ users, includes priority support)

---

## Firebase Free Tier Utilization

Firebase includes a generous free tier:

| Service | Free Limit | 50 Users Usage | Status |
|---------|------------|----------------|--------|
| Firestore reads | 50K/day | ~7.2M/month | **EXCEEDED** |
| Firestore writes | 20K/day | ~2.4K/month | ✓ Within |
| Functions invocations | 2M/month | ~2.16M/month | **EXCEEDED** |
| Compute | 400K vCPU-seconds/month | ~216K | ✓ Within |

**Free tier covers:** ~20-30 active users with current automation frequency.

---

## Comparison: Alternative Infrastructure

### Self-hosted VM (Google Cloud)
- n1-standard-2 VM: ~$50/month
- PostgreSQL database: ~$100/month
- Total: ~$150/month (fixed, regardless of users)
- Per-user cost at 1000 users: $0.15/month ✓ Cheaper

**BUT:** Requires operational overhead, scaling, backups.

### AWS Lambda + DynamoDB
- Lambda: Similar to Cloud Functions (~$0.0002/100ms invocation)
- DynamoDB: $1.25 per million writes, $0.25 per million reads
- **Likely 15-20% cheaper** than Firebase at scale

**BUT:** More complex setup, less integrated authentication.

### Firebase vs Alternatives (1000 users)
| Service | Monthly Cost | Operational Effort |
|---------|--------------|-------------------|
| **Firebase** | $258 | Low ✓ |
| Self-hosted VM | $150 | **HIGH** |
| AWS Lambda/DDB | $220 | Medium |

---

## Recommendations

### Short-term (0-6 months)
1. ✓ Keep current 1-minute automation frequency
2. ✓ Leverage Firebase free tier up to 30 active users
3. Monitor actual costs vs. projections
4. Set up Firebase budget alerts at $50/month

### Medium-term (6-12 months)
1. If >300 active users, implement caching layer
2. Consider 5-minute automation interval option
3. Archive historical data >90 days to Cloud Storage
4. Evaluate AWS Lambda migration if >1000 users

### Cost Control Measures
1. Implement Firestore data expiration (TTL)
2. Monitor automation cycles for runaway behavior
3. Cache external API responses (FoxESS, Amber)
4. Batch settings updates (coalesce writes)

---

## Monitoring & Alerts

### Firebase Cost Monitoring
```
⚠️ Budget Alert: $50/month
🔴 Critical: $100/month
```

### Metrics to Track
- Firestore operations per day
- Cloud Functions invocation count
- Average function execution time
- Network egress per region
- Active user count

### Firebase Console
- Go to: Project Settings → Billing → Overview
- Enable billing alerts via Google Cloud Console
- Export cost data to BigQuery for analysis

---

## Conclusion

**Firebase is cost-effective for Inverter Automation:**
- Small deployments (50 users): **$12.74/month**
- Medium deployments (500 users): **$129.04/month**
- Large deployments (1000 users): **$258.18/month**

**Per-user cost: $0.25-$0.26/month** ← Highly competitive

**Recommended pricing:**
- Free tier: Up to 50 users
- Starter: $5/month (covers costs + support)
- Professional: $15/month (dedicated support)

**At 500+ users**, consider optimizations (caching, reduced frequency) to maintain sub-$0.20 per-user cost and ensure sustainable business model.

---

**Report prepared:** December 23, 2025  
**Next review:** Quarterly or when user count changes by 50%
