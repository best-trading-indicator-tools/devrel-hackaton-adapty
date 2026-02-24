# RevenueCat Benchmark Data

Extracted from RevenueCat State of Subscription Apps 2025 report.  
Source: https://www.revenuecat.com/pdf/state-of-subscription-apps-2025.pdf

All benchmarks are North America-specific unless otherwise noted.

## Files

| File | Description |
|------|-------------|
| `revenue-benchmarks.json` | RPI (D14/D60), LTV (month 1, year 1) by category |
| `conversion-benchmarks.json` | Trial start rate, trial-to-paid, download-to-paid D35, refund rate |
| `pricing-benchmarks.json` | Median prices, subscription mix, annual discount, hybrid monetization share |
| `revenue-milestone-benchmarks.json` | Median days to $1K and $10K revenue milestones |
| `category-benchmarks.json` | Churn floors, retention, renewal rates, LTV benchmarks by category |
| `ltv-constants.json` | Year-1 retention, min churn, max months by subscription period |

## Category mapping

App Store / Play Store categories map to RevenueCat report categories via `categoryMapping` in each file. Examples: `Games` → `Gaming`, `Entertainment` → `Media & Entertainment`, `Social Networking` → `Social & Lifestyle`.
