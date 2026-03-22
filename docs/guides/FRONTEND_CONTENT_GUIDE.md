# Frontend Content Guide

Last updated: 2026-03-22

## Purpose

This guide is the canonical workflow for public-facing frontend content in this
repository: landing pages, calculators, the blog landing page, and individual
blog posts.

Use it before adding or moving any public page so URL structure, SEO tags,
redirects, and tests stay consistent.

## Canonical Public URL Conventions

### Public marketing and utility pages

- Single-page public surfaces live as `frontend/*.html`.
- Examples:
  - `frontend/index.html` -> `/`
  - `frontend/battery-roi-calculator.html` -> `/battery-roi-calculator.html`
  - `frontend/market-insights.html` -> `/market-insights.html`

### Blog landing page

- The blog landing page lives at `frontend/blog/index.html`.
- Canonical public URL: `/blog/`
- This is the collection/index page, not an individual article slug.

### Blog posts

- Individual blog posts live as standalone slug folders under `frontend/<slug>/index.html`.
- Examples:
  - `frontend/home-battery-automation-options-compared/index.html` ->
    `/home-battery-automation-options-compared/`
  - `frontend/battery-automation-roi-examples/index.html` ->
    `/battery-automation-roi-examples/`

### Why posts are root-level instead of under `/blog/<slug>/`

- This repo currently treats post URLs as short evergreen marketing slugs.
- Those root-level slugs are already the canonical URLs used in:
  - `frontend/blog/index.html`
  - `frontend/index.html`
  - `frontend/sitemap.xml`
  - `tests/frontend/seo.spec.js`
- Do not move published posts under `/blog/<slug>/` unless there is a deliberate
  SEO migration plan with redirects and updated tests.

### Alias redirects

- If a `/blog/<slug>/` alias is useful for discoverability or old links,
  redirect it to the canonical root-level post URL in `firebase.json`.
- The canonical URL should still stay root-level unless the repo adopts a new
  blog URL policy explicitly.

## Required SEO and Metadata Rules

Every public page must include:

- a canonical tag with the final production URL
- `meta name="robots"` set to `index, follow`
- `meta name="googlebot"` with the crawl-preview policy used elsewhere in the repo
- Open Graph tags with `og:url`, `og:title`, `og:description`, `og:image`
- Twitter card tags matching the Open Graph intent
- JSON-LD structured data appropriate for the page type

### Structured data by page type

- Landing page: `WebPage`, `WebSite`, `Organization`, plus any relevant product schema
- Blog landing page: `CollectionPage`, `BreadcrumbList`, `ItemList`
- Blog post: `WebPage`, `BreadcrumbList`, `BlogPosting`, `FAQPage` when FAQ content exists
- Calculator/tool page: `WebPage`, tool/app schema, and `FAQPage` when relevant

## Internal vs Public Crawl Rules

Public pages should be crawlable.

Internal app pages should remain non-indexed.

### Public pages

- `index, follow`
- matching `X-Robots-Tag` headers in `firebase.json`

### Internal pages

- `noindex, nofollow`
- matching `X-Robots-Tag: noindex, nofollow, noarchive`

Do not make an authenticated app page crawlable without an explicit product and
SEO decision.

## Checklist for Adding a New Blog Post

1. Create `frontend/<slug>/index.html`.
2. Use a lowercase hyphenated slug and keep it stable after publishing.
3. Add canonical, robots, Open Graph, Twitter, and JSON-LD metadata.
4. Link the post from `frontend/blog/index.html`.
5. Update the landing-page blog section in `frontend/index.html` if the post is
   meant to be featured there.
6. Add the canonical URL to `frontend/sitemap.xml`.
7. Add redirect aliases in `firebase.json` only if needed for old paths or
   `/blog/<slug>/` convenience paths.
8. Add or update assertions in `tests/frontend/seo.spec.js`.

## Checklist for Adding a New Public Non-Blog Page

1. Create the page in `frontend/*.html` unless it needs a directory-style URL.
2. Add canonical and structured data.
3. Decide whether the page should be crawlable.
4. Add any required `firebase.json` redirects or headers.
5. Add the page to `frontend/sitemap.xml` if it is public and indexable.
6. Add focused frontend SEO coverage if the page introduces new metadata patterns.

## Files That Usually Change Together

For new public content, expect to review these files together:

- `frontend/blog/index.html`
- `frontend/index.html`
- `frontend/sitemap.xml`
- `firebase.json`
- `tests/frontend/seo.spec.js`

That set is the practical contract for marketing and blog content in this repo.