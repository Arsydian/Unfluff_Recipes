# UnfluffRecipes — Tabular Recipe Notation (TRN) Compiler

![Version](https://img.shields.io/badge/version-1.0.1-003366.svg)
![Cloudflare](https://img.shields.io/badge/deploy-Cloudflare%20Workers%20%2F%20Pages-F38020.svg)
![License](https://img.shields.io/badge/format-Tabular%20Recipe%20Notation-1b4d89.svg)

**UnfluffRecipes** strips life stories, popups, and prose bloat from recipe URLs or raw recipe text and compiles them into **Tabular Recipe Notation (TRN)**—an engineering specification sheet inspired by *Cooking for Engineers*, styled in a crisp early-2000s technical web + CAD blueprint aesthetic.

---

## Core Capabilities

- **Dual TRN View Toggle:** Switch seamlessly between the classic **Nested TRN Dependency Grid** (merged `rowSpan` / `colSpan` matrix tracing ingredients into intermediate sub-assemblies) and the **Row-per-Step Engineering Summary Table**.
- **Heuristic + Cloudflare Workers AI Parsing:**
  - Server-side edge scraper extracts `schema.org/Recipe` JSON-LD, Microdata, and semantic HTML.
  - Deterministic heuristic compiler tokenizes fractions, units, cookware hardware, and critical target temperatures.
  - Automatically falls back to **Cloudflare Workers AI** (`@cf/meta/llama-3.1-8b-instruct`) when heuristic confidence is low (if `AI` binding is enabled).
- **Paste Raw Recipe Text Tab:** Convert recipes from paywalled sites, PDFs, or personal notes without needing a live URL.
- **Automatic "Divided Ingredient" Row Splitting:** Automatically splits lines like `"1 cup sugar, divided"` into step-pinned rows so merged dependency cells never cross.
- **Live Scaling & Density-Aware Unit Conversion:** Scale `0.5x`, `1x`, `2x`, `3x`, or custom multipliers and toggle **Original**, **Metric (`g`/`mL`/`°C`)**, and **US Imperial (`oz`/`cups`/`°F`)**, including inline step & critical temperature rewriting.
- **Inline Cell Editing & Row Controls:** Click any title, ingredient name, prep note, instruction cell, or output label to edit inline; split (`÷2`), reorder (`↑`/`↓`), add, or remove rows before exporting.
- **Engineering Spec Header Block:** Displays Doc ID, Rev, Prep/Cook/Total duration, required hardware/cookware tags, and critical target temperatures.
- **Kitchen Bench Mode (Screen Wake Lock):** Keeps your device screen awake while cooking and lets you tap any ingredient or step cell to mark it `[DONE]`.
- **Client-Side PDF Export & Print Blueprint:** One-click `.pdf` file download via `html2pdf.js` plus dedicated `@media print` CSS.
- **2-Week Expiring Shareable Links:** Generate shareable links for compiled (and edited) recipes with strict **14-day (`1,209,600` seconds) expiration**.

---

## Zero-CLI GitHub → Cloudflare Deployment Guide

You do **not** need to run any CLI commands locally. Deploy straight from your browser by connecting GitHub to Cloudflare:

### Step 1: Push This Repository to GitHub
Create a new repository on GitHub and push the contents of `UnfluffRecipes/` (via GitHub Desktop, VS Code Source Control, or GitHub web upload). GitHub Actions (`.github/workflows/ci.yml`) will automatically run `typecheck`, `test`, and `build` on every push.

### Step 2: Connect the GitHub Repo in the Cloudflare Dashboard
1. Log in to the **Cloudflare Dashboard** and navigate to **Compute (Workers) → Workers & Pages → Create**.
2. Choose **Import a repository** and select your `UnfluffRecipes` GitHub repository.
3. Verify the build settings (pre-configured via `wrangler.jsonc`):
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy` *(executed automatically by Cloudflare's cloud builder)*
4. Click **Save and Deploy**. Cloudflare automatically builds `./dist` and deploys `src/worker/index.ts` on every commit to `main`.

> *(Alternative: If deploying as **Cloudflare Pages** instead of Workers Builds, set the Build output directory to `dist` — `functions/api/[[route]].ts` automatically handles `/api/*` routes.)*

### Step 3: Optional Dashboard Bindings (GUI Only)
Your app works out of the box immediately after Step 2 (using heuristic parsing and HMAC-signed 14-day share tokens). To unlock short `/r/<id>` KV links and Workers AI fallback:

1. **Attach Workers AI (`AI`)**:
   - In your Worker → **Settings → Bindings → Add → Workers AI** → Variable name: `AI`.
2. **Attach KV Storage (`RECIPE_KV`) for Short 14-Day Share Links**:
   - Go to **Storage & Databases → KV → Create a namespace** (e.g., `unfluff-recipes-kv`).
   - In your Worker → **Settings → Bindings → Add → KV Namespace** → Variable name: `RECIPE_KV` → select your namespace.
3. **Optional `SHARE_SIGNING_KEY` Secret**:
   - In **Settings → Variables and Secrets**, add `SHARE_SIGNING_KEY` with a random passphrase to keep signed `?r=tok...` links valid across Worker restarts even without KV.

---

## Versioning & Project Structure

- **Current Version:** `1.0.1` (synchronized across `package.json`, `src/shared/version.ts`, `README.md`, and `window.api.appVersion`).
- **Key Directories:**
  - `src/shared/` — Shared TypeScript TRN contracts & retention/version constants
  - `src/worker/` — Hono API, HTML recipe scraper, heuristic TRN compiler, Workers AI fallback, 14-day KV/token store
  - `src/client/` — Retro-technical React UI, unit/temp conversion math, `rowspan`/`colspan` matrix solver, PDF exporter
  - `functions/api/` — Cloudflare Pages Functions catch-all adapter
  - `tests/` — Zero-dependency TypeScript test suite (`npm test`)
