# Frontend Content Guide

Last updated: 2026-03-26

## Purpose

This guide is the canonical workflow for public-facing frontend content in this
repository: landing pages, tools, market-insights preview, blog pages, sitemap,
robots policy, and answer-engine discovery files.

## Canonical Public URL Conventions

### Flat public pages

Single-file public pages currently live at `frontend/*.html`.

Examples:

- `frontend/index.html` -> `/`
- `frontend/battery-roi-calculator.html` -> `/battery-roi-calculator.html`
- `frontend/battery-wear-estimator.html` -> `/battery-wear-estimator.html`
- `frontend/privacy.html` -> `/privacy.html`
- `frontend/terms.html` -> `/terms.html`

### Directory-style public pages

Directory-backed public pages currently live as `frontend/<slug>/index.html`.

Examples:

- `frontend/blog/index.html` -> `/blog/`
- `frontend/market-insights/index.html` -> `/market-insights/`
- `frontend/rule-template-recommender/index.html` -> `/rule-template-recommender/`
- `frontend/home-battery-automation-options-compared/index.html` ->
  `/home-battery-automation-options-compared/`
- `frontend/battery-automation-roi-examples/index.html` ->
  `/battery-automation-roi-examples/`

## Public vs Internal Rules

### Public, crawlable surfaces

Current crawlable URLs are:

- `/`
- `/battery-roi-calculator.html`
- `/battery-wear-estimator.html`
- `/market-insights/`
- `/rule-template-recommender/`
- `/blog/`
- `/home-battery-automation-options-compared/`
- `/battery-automation-roi-examples/`
- `/privacy.html`
- `/terms.html`

These should be:

- in `frontend/sitemap.xml`
- represented correctly in `frontend/llms.txt`
- covered in `frontend/llms-full.txt` where relevant
- marked `index, follow`
- backed by matching `X-Robots-Tag` headers in `firebase.json`

### Internal or authenticated surfaces

Current internal/noindex pages include:

- `login.html`
- `reset-password.html`
- `setup.html`
- `app.html`
- `control.html`
- `history.html`
- `roi.html`
- `rules-library.html`
- `market-insights.html`
- `settings.html`
- `admin.html`
- `test.html`

These should remain:

- `noindex, nofollow`
- covered by `firebase.json` noindex headers where applicable

Important distinctions:

- `/market-insights/` is public
- `market-insights.html` is internal/member-only
- `/rule-template-recommender/` is public
- `rules-library.html` is internal/member-only
- `test.html` is an internal Automation Lab page and should not be promoted as
  public product content

## Required SEO and Metadata Rules

Every public page should include:

- canonical URL
- `meta name="robots"` set to `index, follow`
- `meta name="googlebot"` matching the repo's current crawl-preview policy
- Open Graph tags
- Twitter card tags
- JSON-LD appropriate to the page type

### Recommended structured data by page type

- landing page: `WebPage`, `WebSite`, `Organization`
- blog index: `CollectionPage`, `BreadcrumbList`, `ItemList`
- blog post: `WebPage`, `BreadcrumbList`, `BlogPosting`, and `FAQPage` when
  applicable
- tool/calculator page: `WebPage`, `WebApplication`, and `FAQPage` when
  applicable
- market-insights preview: `WebPage`, `Dataset`, `BreadcrumbList`, optional
  `FAQPage`

## Blog Slug Rules

Current blog-post policy:

- posts use short evergreen root-level slugs
- canonical URLs are not under `/blog/<slug>/`

Examples:

- `/home-battery-automation-options-compared/`
- `/battery-automation-roi-examples/`

If `/blog/<slug>/` aliases are needed, add redirects in `firebase.json`, but
keep the canonical URL unchanged unless there is an explicit migration plan.

## Files That Usually Change Together

For public-content changes, expect to review:

- `frontend/index.html`
- `frontend/blog/index.html`
- public tool or post page
- `frontend/sitemap.xml`
- `frontend/llms.txt`
- `frontend/llms-full.txt`
- `firebase.json`
- `tests/frontend/seo.spec.js`
- `tests/frontend/tools.spec.js` when tool behavior changes

## Checklist for New Public Content

1. Create the page at the correct flat or directory-backed path.
2. Add canonical, robots, Open Graph, Twitter, and JSON-LD metadata.
3. Add or update links from other public pages when relevant.
4. Add the canonical URL to `frontend/sitemap.xml`.
5. Update `frontend/llms.txt` and `frontend/llms-full.txt` when the new page is
   part of the intended public answer-engine surface.
6. Add or update `firebase.json` headers or redirects if needed.
7. Add or update focused Playwright SEO coverage.

## Checklist for Internal Page Changes

1. Keep `noindex, nofollow` metadata in place.
2. Keep `firebase.json` noindex headers aligned.
3. Do not add internal pages to `sitemap.xml` or `llms.txt`.
4. If an internal page gains a public companion, document both surfaces
   explicitly so the public/internal split stays clear.
