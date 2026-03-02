# SOIS Website Dataset Snapshot

Generated: 2026-03-02T14:42:29.809Z
Source: https://appstate2.vercel.app
Discovered data files: 19

## Methodology Facts
- Adapty platform tracked revenue: $3B
- Adapty apps connected: 16K+
- Adapty historical SLA: 99.99%

## Usage Notes
- This file summarizes chart datasets from the SOIS public web app.
- Use this as supporting context and idea discovery for Sauce narratives.
- Prefer official SOIS API evidence lines for strict numeric claims in generation.

## Direct Conversion Benchmarks
- Dataset: `conversions-direct`
- Category hint: `conversions`
- Source URL: https://appstate2.vercel.app/data/conversions-direct.json
- Rows: 54
- Columns: `country`, `region`, `category`, `cohort_type`, `install_to_direct_rate`, `install_to_paid_rate`, `paid_to_renewal1_rate`, `paid_to_renewal2_rate`, `paid_to_renewal3_rate`, `paid_to_renewal4_rate`, `paid_to_renewal5_rate`, `paid_to_refund_rate`
- Filter examples: country=All ; region=Global | APAC | Europe | LATAM | MEA ; category=All | EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS ; cohort_type=direct
- Metric summary:
  - Install To Direct Rate: median 1.42% | p90 3.77% | max 7.31%
  - Install To Paid Rate: median 2.95% | p90 5.62% | max 9.33%
  - Paid To Renewal1 Rate: median 27.43% | p90 32.19% | max 37.05%
  - Paid To Renewal2 Rate: median 17.26% | p90 20.66% | max 26.83%

## Trial Conversion Benchmarks
- Dataset: `conversions-trial`
- Category hint: `conversions`
- Source URL: https://appstate2.vercel.app/data/conversions-trial.json
- Rows: 54
- Columns: `country`, `region`, `category`, `cohort_type`, `install_to_trial_rate`, `trial_to_paid_rate`, `paid_to_renewal1_rate`, `paid_to_renewal2_rate`, `paid_to_renewal3_rate`, `paid_to_renewal4_rate`, `paid_to_renewal5_rate`, `paid_to_refund_rate`
- Filter examples: country=All ; region=Global | APAC | Europe | LATAM | MEA ; category=All | EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS ; cohort_type=trial
- Metric summary:
  - Install To Trial Rate: median 7.44% | p90 11.95% | max 15.81%
  - Trial To Paid Rate: median 20.33% | p90 32.44% | max 43.32%
  - Paid To Renewal1 Rate: median 45.91% | p90 54.79% | max 60.12%
  - Paid To Renewal2 Rate: median 32.12% | p90 40.90% | max 45.89%

## Discount Usage by Category
- Dataset: `discount-usage`
- Category hint: `market`
- Source URL: https://appstate2.vercel.app/data/discount-usage.json
- Rows: 16
- Columns: `year`, `category`, `discount_share`, `no_discount_share`
- Filter examples: category=EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS | LIFESTYLE
- Metric summary:
  - Year: median 2,025 | p90 2,025 | max 2,025
  - Discount Share: median 9.18% | p90 11.42% | max 14.48%
  - No Discount Share: median 91.02% | p90 98.56% | max 98.66%

## Fastest Growing Countries YoY
- Dataset: `fastest-growing-countries`
- Category hint: `market`
- Source URL: https://appstate2.vercel.app/data/fastest-growing-countries.json
- Rows: 16
- Columns: `store`, `region`, `country`, `growth_rate`
- Filter examples: store=app_store | play_store ; region=APAC | Europe | LATAM | MEA | North America ; country=Australia | Japan | France | Germany | Italy
- Metric summary:
  - Growth Rate: median 58.08% | p90 89.16% | max 95.59%

## Install LTV by Category
- Dataset: `install-ltv`
- Category hint: `ltv`
- Source URL: https://appstate2.vercel.app/data/install-ltv.json
- Rows: 53
- Columns: `country`, `region`, `category`, `avg_ltv_380`, `install_to_direct_rate`, `install_to_paid_rate`, `install_ltv`
- Filter examples: country=All ; region=Global | APAC | Europe | LATAM | MEA ; category=All | EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS
- Metric summary:
  - Avg Ltv 380: median 25.216 | p90 36.976 | max 45.764
  - Install To Direct Rate: median 1.42% | p90 3.77% | max 7.31%
  - Install To Paid Rate: median 2.95% | p90 5.62% | max 9.33%
  - Install Ltv: median 0.755 | p90 1.879 | max 3.691

## Install-to-Paid Time
- Dataset: `install-to-paid-time`
- Category hint: `market`
- Source URL: https://appstate2.vercel.app/data/install-to-paid-time.json
- Rows: 324
- Columns: `country`, `region`, `category`, `time_bucket`, `bucket_share`
- Filter examples: country=All ; region=Global | APAC | Europe | LATAM | MEA ; category=All | EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS ; time_bucket=Day0 | Day15_30 | Day1_3 | Day31_plus | Day4_7
- Metric summary:
  - Bucket Share: median 3.67% | p90 83.55% | max 90.18%

## Install-to-Trial Time
- Dataset: `install-to-trial-time`
- Category hint: `market`
- Source URL: https://appstate2.vercel.app/data/install-to-trial-time.json
- Rows: 324
- Columns: `country`, `region`, `category`, `time_bucket`, `bucket_share`
- Filter examples: country=All ; region=Global | APAC | Europe | LATAM | MEA ; category=All | EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS ; time_bucket=Day0 | Day15_30 | Day1_3 | Day31_plus | Day4_7
- Metric summary:
  - Bucket Share: median 1.91% | p90 87.62% | max 95.27%

## LTV Dashboard
- Dataset: `ltv-analytics`
- Category hint: `ltv`
- Source URL: https://appstate2.vercel.app/data/ltv-analytics.json
- Rows: 1,620
- Columns: `country`, `region`, `category`, `product_set`, `cohort_type`, `days_after_first_purchase`, `avg_ltv`
- Filter examples: country=All ; region=Global | APAC | Europe | LATAM | MEA ; category=All | EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS ; product_set=annual | monthly | weekly ; cohort_type=direct | trial
- Metric summary:
  - Days After First Purchase: median 99 | p90 380.0 | max 380.0
  - Avg Ltv: median 26.081 | p90 44.922 | max 83.092

## Top Countries by LTV
- Dataset: `ltv-by-region`
- Category hint: `ltv`
- Source URL: https://appstate2.vercel.app/data/ltv-by-region.json
- Rows: 14
- Columns: `country`, `region`, `category`, `avg_ltv`
- Filter examples: country=Japan | Singapore | Australia | Norway | Denmark ; region=APAC | Europe | LATAM | MEA | North America ; category=All
- Metric summary:
  - Avg Ltv: median 44.02 | p90 47.98 | max 50.17

## Conversion by Price Buckets
- Dataset: `pricing-conversion`
- Category hint: `pricing`
- Source URL: https://appstate2.vercel.app/data/pricing-conversion.json
- Rows: 1,732
- Columns: `country`, `region`, `category`, `product_set`, `price_bucket`, `metric_name`, `metric_value`
- Filter examples: country=All ; region=Global | APAC | Europe | LATAM | MEA ; category=All | EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS ; product_set=annual | monthly | weekly ; price_bucket=High price | Low price | Lower mid price | Upper mid price
- Metric summary:
  - Metric Value: median 0.009 | p90 0.048 | max 0.237

## Price Distribution by Region and Category
- Dataset: `pricing-data`
- Category hint: `pricing`
- Source URL: https://appstate2.vercel.app/data/pricing-data.json
- Rows: 15,635
- Columns: `year`, `country`, `region`, `category`, `product_set`, `quantile_type`, `price_usd`
- Filter examples: country=Argentina | Australia | Brazil | Canada | Chile ; region=LATAM | APAC | North America | Europe | MEA ; category=All | EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS ; product_set=annual | monthly | weekly ; quantile_type=p10_app | p25_app | p50_app | p75_app | p90_app
- Metric summary:
  - Year: median 2,024 | p90 2,026 | max 2,026
  - Price Usd: median 10.52 | p90 47.13 | max 160.0

## LTV by Price Buckets
- Dataset: `pricing-ltv`
- Category hint: `pricing`
- Source URL: https://appstate2.vercel.app/data/pricing-ltv.json
- Rows: 643
- Columns: `country`, `region`, `category`, `product_set`, `price_bucket`, `median_ltv_380`, `avg_ltv_380`
- Filter examples: country=All ; region=Global | APAC | Europe | LATAM | MEA ; category=All | EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS ; product_set=annual | monthly | weekly ; price_bucket=High price | Low price | Lower mid price | Upper mid price
- Metric summary:
  - Median Ltv 380: median 16.045 | p90 48.338 | max 117.0
  - Avg Ltv 380: median 36.199 | p90 65.653 | max 117.1

## Refund Share by Region and Category
- Dataset: `refund-share`
- Category hint: `refunds`
- Source URL: https://appstate2.vercel.app/data/refund-share.json
- Rows: 108
- Columns: `country`, `region`, `category`, `cohort_type`, `refunded_revenue_share`
- Filter examples: country=All ; region=Global | APAC | Europe | LATAM | MEA ; category=All | EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS ; cohort_type=non_trial | trial
- Metric summary:
  - Refunded Revenue Share: median 3.23% | p90 5.45% | max 13.98%

## Renewal by Price Bucket
- Dataset: `renewal-by-price`
- Category hint: `retention`
- Source URL: https://appstate2.vercel.app/data/renewal-by-price.json
- Rows: 427
- Columns: `country`, `region`, `category`, `product_set`, `price_bucket`, `renewal1_to_renewal2_rate`, `renewal2_to_renewal3_rate`
- Filter examples: country=All ; region=Global | APAC | Europe | LATAM | MEA ; category=All | EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS ; product_set=monthly | weekly ; price_bucket=Tier 1 (lowest 25%) | Tier 2 (25-50%) | Tier 3 (50-75%) | Tier 4 (highest 25%)
- Metric summary:
  - Renewal1 To Renewal2 Rate: median 47.83% | p90 59.28% | max 78.39%
  - Renewal2 To Renewal3 Rate: median 77.76% | p90 82.53% | max 90.35%

## Retention by Category and Plan
- Dataset: `retention`
- Category hint: `retention`
- Source URL: https://appstate2.vercel.app/data/retention.json
- Rows: 1,296
- Columns: `country`, `region`, `category`, `product_set`, `is_trial`, `metric_category`, `retention_rate`
- Filter examples: country=All ; region=Global | APAC | Europe | LATAM | MEA ; category=All | EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS ; product_set=annual | monthly | weekly ; is_trial=non_trial | trial
- Metric summary:
  - Metric Category: median 190.0 | p90 380.0 | max 380.0
  - Retention Rate: median 24.30% | p90 99.81% | max 100.00%

## Revenue Share by Product Type
- Dataset: `revenue-by-product-type`
- Category hint: `market`
- Source URL: https://appstate2.vercel.app/data/revenue-by-product-type.json
- Rows: 810
- Columns: `year`, `region`, `category`, `product_type`, `plan_revenue_share`
- Filter examples: region=Global | APAC | Europe | LATAM | MEA ; category=All | UTILITIES | PRODUCTIVITY | PHOTO_AND_VIDEO | ENTERTAINMENT ; product_type=weekly | annual | monthly | other | one_time_purchase
- Metric summary:
  - Year: median 2,024 | p90 2,025 | max 2,025
  - Plan Revenue Share: median 13.02 | p90 52.3 | max 86.06

## Revenue by Region
- Dataset: `revenue-by-region`
- Category hint: `market`
- Source URL: https://appstate2.vercel.app/data/revenue-by-region.json
- Rows: 15
- Columns: `year`, `region`, `share`
- Filter examples: region=North America | Europe | APAC | MEA | LATAM
- Metric summary:
  - Year: median 2,024 | p90 2,025 | max 2,025
  - Share: median 9.5 | p90 56.84 | max 58.84

## Revenue Concentration (Top 10%)
- Dataset: `revenue-concentration`
- Category hint: `market`
- Source URL: https://appstate2.vercel.app/data/revenue-concentration.json
- Rows: 162
- Columns: `year`, `region`, `category`, `top_10pct_apps`, `top_10pct_revenue`, `revenue_share_top_10pct`
- Filter examples: region=APAC | Europe | Global | LATAM | MEA ; category=All | EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS
- Metric summary:
  - Year: median 2,024 | p90 2,025 | max 2,025
  - Top 10pct Apps: median 32 | p90 200.0 | max 1,843
  - Top 10pct Revenue: median 12,360,857.2 | p90 88,205,083.54 | max 849,780,943.03
  - Revenue Share Top 10pct: median 92.93% | p90 95.98% | max 97.90%

## Trial Usage by Category
- Dataset: `trial-usage`
- Category hint: `market`
- Source URL: https://appstate2.vercel.app/data/trial-usage.json
- Rows: 16
- Columns: `year`, `category`, `trial_share`, `no_trial_share`
- Filter examples: category=EDUCATION | ENTERTAINMENT | GRAPHICS_AND_DESIGN | HEALTH_AND_FITNESS | LIFESTYLE
- Metric summary:
  - Year: median 2,025 | p90 2,025 | max 2,025
  - Trial Share: median 72.54% | p90 82.07% | max 84.27%
  - No Trial Share: median 28.77% | p90 41.48% | max 42.86%

## Implementation Notes
- Generated by `scripts/build-sois-site-context.mjs`.
- Machine-readable snapshot lives at `data/sois-site/context.json`.
- Full hardcoded payload bundle lives at `data/sois-site/all-datasets.json`.
