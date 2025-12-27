# Documentation Index

**Last Updated:** December 25, 2025  
**Purpose:** Central index for all project documentation

---

## Quick Links

### Essential Documentation (Start Here)
1. **[README.md](../README.md)** - Project overview and getting started
2. **[SETUP.md](SETUP.md)** - Firebase deployment and configuration
3. **[API.md](API.md)** - Complete API reference
4. **[AUTOMATION.md](AUTOMATION.md)** - Rule configuration and automation logic

### Feature-Specific Guides
5. **[README_CURTAILMENT.md](README_CURTAILMENT.md)** - Solar curtailment feature guide
6. **[CURTAILMENT_QUICK_START.md](CURTAILMENT_QUICK_START.md)** - Quick setup for curtailment
7. **[BACKGROUND_AUTOMATION.md](BACKGROUND_AUTOMATION.md)** - Scheduled automation details
8. **[TESLA_SECURITY.md](TESLA_SECURITY.md)** - Tesla integration security guide

### Operations & Maintenance
9. **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - CI/CD and deployment procedures
10. **[OPTIMIZATIONS.md](OPTIMIZATIONS.md)** - Performance optimization techniques
11. **[LOGGING_AUDIT_REPORT.md](LOGGING_AUDIT_REPORT.md)** - Logging analysis (original audit)
12. **[LOGGING_OPTIMIZATION_SUMMARY.md](LOGGING_OPTIMIZATION_SUMMARY.md)** - ✨ NEW: Cost reduction via logging optimization

### Analysis & Planning
13. **[COST_ANALYSIS_2025.md](COST_ANALYSIS_2025.md)** - Firebase cost projections
14. **[FIREBASE_COST_ANALYSIS.md](FIREBASE_COST_ANALYSIS.md)** - Detailed Firebase pricing breakdown
15. **[TEST_COVERAGE_REPORT.md](TEST_COVERAGE_REPORT.md)** - Unit test coverage summary

### Archived Documentation
16. **[archive/](archive/)** - Historical docs (completed milestones, bugfixes, analyses)

---

## Documentation Categories

### Core Documentation (Always Relevant)
These docs are maintained and up-to-date:

| Document | Purpose | Audience |
|----------|---------|----------|
| [README.md](../README.md) | Project overview | All users |
| [SETUP.md](SETUP.md) | Deployment guide | Developers |
| [API.md](API.md) | API reference | Frontend devs |
| [AUTOMATION.md](AUTOMATION.md) | Rule engine docs | Power users |

### Feature Guides (Reference)
Feature-specific documentation:

| Document | Feature | Status |
|----------|---------|--------|
| [README_CURTAILMENT.md](README_CURTAILMENT.md) | Solar curtailment | ✅ Stable |
| [CURTAILMENT_QUICK_START.md](CURTAILMENT_QUICK_START.md) | Curtailment setup | ✅ Stable |
| [BACKGROUND_AUTOMATION.md](BACKGROUND_AUTOMATION.md) | Scheduler | ✅ Stable |
| [TESLA_SECURITY.md](TESLA_SECURITY.md) | Tesla OAuth | ✅ Stable |

### Operations Guides (Maintenance)
For DevOps and maintenance:

| Document | Purpose | Frequency |
|----------|---------|-----------|
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | CI/CD procedures | Per deploy |
| [OPTIMIZATIONS.md](OPTIMIZATIONS.md) | Performance tuning | As needed |
| [LOGGING_OPTIMIZATION_SUMMARY.md](LOGGING_OPTIMIZATION_SUMMARY.md) | Log cost reduction | Periodic review |

### Analysis Documents (Planning)
Cost and coverage analysis:

| Document | Purpose | Update Frequency |
|----------|---------|------------------|
| [COST_ANALYSIS_2025.md](COST_ANALYSIS_2025.md) | Firebase cost projections | Quarterly |
| [FIREBASE_COST_ANALYSIS.md](FIREBASE_COST_ANALYSIS.md) | Detailed cost breakdown | Bi-annual |
| [TEST_COVERAGE_REPORT.md](TEST_COVERAGE_REPORT.md) | Unit test coverage | After major features |

---

## Archived Documentation

The following docs have been moved to `archive/` as they represent:
- ✅ Completed milestones
- 🐛 Resolved bugs
- 📊 Point-in-time snapshots
- 📝 Historical implementation notes

### Milestone & Summary Docs
- `COMPREHENSIVE_PROJECT_ANALYSIS.md` - Security audit (Dec 2024)
- `WORK_COMPLETION_SUMMARY.md` - Testing milestone (Dec 2025)
- `QUALITY_CONTROL_SUMMARY.md` - QA implementation (Dec 2025)
- `REFACTORING_COMPLETE.md` - Code refactoring summary
- `CURTAILMENT_DELIVERY_SUMMARY.md` - Curtailment feature delivery
- `CURTAILMENT_IMPLEMENTATION_CHECKPOINT.md` - Feature checkpoint
- `CURTAILMENT_PERFORMANCE_ANALYSIS.md` - Performance metrics

### Feature Implementation Docs
- `IDLE_LOGOUT_IMPLEMENTATION.md` - Session timeout feature
- `ROI_ACTUAL_PRICES_IMPLEMENTATION.md` - ROI calculator feature
- `TIMEZONE_IMPLEMENTATION.md` - Multi-timezone support

### Bugfix & Technical Detail Docs
- `FIX_SUMMARY.md` - User profile initialization fix
- `MIDNIGHT_CROSSING_FIX.md` - Scheduler midnight bug
- `MIDNIGHT_CROSSING_TESTS.md` - Test suite for midnight bug
- `EXPORT_LIMIT_POWER_FIX.md` - Curtailment power limit fix
- `FOXESS_SCHEDULER_REORDERING.md` - FoxESS API quirk documentation

### Analysis & Verification Docs
- `TIMEZONE_SCENARIOS.md` - Timezone testing scenarios
- `TIMEZONE_VERIFICATION.md` - Timezone test results
- `SESSION_AND_CONCURRENCY_ANALYSIS.md` - Concurrency patterns
- `COST_ANALYSIS_VALIDATION.md` - Cost model validation
- `TESTING_AND_COST_SUMMARY.md` - Combined test/cost report
- `SCHEDULER_TROUBLESHOOTING.md` - Scheduler debugging guide
- `SOLAR_CURTAILMENT_ASSESSMENT.md` - Feature feasibility study
- `CURTAILMENT_DISCOVERY_PAGE.md` - UI design document

**Note:** Archived docs remain available for historical reference but are no longer actively maintained.

---

## Document Maintenance Guidelines

### When to Update Core Docs
- **API.md** - Update when API endpoints change
- **AUTOMATION.md** - Update when rule engine behavior changes
- **SETUP.md** - Update when deployment procedure changes
- **README.md** - Update when major features added

### When to Archive Docs
Archive a document when:
1. Feature implementation is complete and stable
2. Bug has been fixed and validated
3. Analysis/snapshot is superseded by newer data
4. Document describes temporary/transitional state

### When to Create New Docs
Create a new document when:
1. Adding a major new feature (requires user guide)
2. Significant architectural change (requires explanation)
3. Cost or performance analysis (requires detailed breakdown)
4. Security or compliance requirement (requires documentation trail)

---

## Documentation Standards

### Naming Conventions
- `README_<feature>.md` - User-facing feature guide
- `<FEATURE>_IMPLEMENTATION.md` - Technical implementation details
- `<TOPIC>_ANALYSIS.md` - Analysis or research document
- `<FEATURE>_QUICK_START.md` - Quick setup guide
- `<BUG>_FIX.md` - Bugfix documentation

### Required Sections
All docs should include:
1. **Purpose** - Why this document exists
2. **Audience** - Who should read it
3. **Last Updated** - Date of last significant change
4. **Status** - Draft, Stable, Archived, Deprecated

### Markdown Style
- Use `#` for title, `##` for major sections, `###` for subsections
- Include table of contents for docs > 200 lines
- Use code blocks with language tags (```javascript, ```bash, etc.)
- Use tables for structured data
- Use emojis sparingly (✅ ❌ ⚠️ only)

---

## Quick Reference by Role

### New Developer Onboarding
1. [README.md](../README.md)
2. [SETUP.md](SETUP.md)
3. [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
4. [API.md](API.md)

### End User (Power User)
1. [README.md](../README.md)
2. [AUTOMATION.md](AUTOMATION.md)
3. [README_CURTAILMENT.md](README_CURTAILMENT.md)
4. [CURTAILMENT_QUICK_START.md](CURTAILMENT_QUICK_START.md)

### DevOps / SRE
1. [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
2. [OPTIMIZATIONS.md](OPTIMIZATIONS.md)
3. [LOGGING_OPTIMIZATION_SUMMARY.md](LOGGING_OPTIMIZATION_SUMMARY.md)
4. [COST_ANALYSIS_2025.md](COST_ANALYSIS_2025.md)

### Security Auditor
1. [TESLA_SECURITY.md](TESLA_SECURITY.md)
2. [API.md](API.md) (auth sections)
3. [archive/COMPREHENSIVE_PROJECT_ANALYSIS.md](archive/COMPREHENSIVE_PROJECT_ANALYSIS.md) (security findings)

---

## Change Log

| Date | Change | Files Affected |
|------|--------|----------------|
| 2025-12-25 | Created documentation index | This file |
| 2025-12-25 | Archived 20+ milestone/bugfix docs | Moved to archive/ |
| 2025-12-25 | Added logging optimization guide | LOGGING_OPTIMIZATION_SUMMARY.md |

---

## Need Help?

- **Can't find a doc?** Check the `archive/` folder for historical documents
- **Doc is outdated?** Open an issue or update it (follow the maintenance guidelines above)
- **Need new doc type?** Propose naming convention and structure in an issue first

**Maintainer:** See repo contributors  
**Last Audit:** December 25, 2025
