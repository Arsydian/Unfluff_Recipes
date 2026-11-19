/**
 * ============================================================================
 * Recipe Web Scraper & Structured Metadata Extractor
 * ----------------------------------------------------------------------------
 * Fetches recipe web pages from public URLs and extracts clean ingredient and
 * instruction arrays across three prioritized layers:
 *   1. schema.org/Recipe JSON-LD (`<script type="application/ld+json">`)
 *   2. schema.org Microdata (`itemprop="recipeIngredient"`, etc.)
 *   3. Semantic HTML heuristic extraction + raw-text fallback
 * ============================================================================
 */

import { parseHTML } from 'linkedom';
import type { ExtractedRawRecipe } from '../shared/types';
import { extractRecipeFromRawText } from './heuristicParser';

export { extractRecipeFromRawText };

// ============================================================================
// URL Validation & Network Fetcher (SSRF & Size-Cap Hardened)
// ============================================================================

/** Maximum HTTP redirects followed when fetching a recipe URL. */
const MAX_REDIRECT_HOPS = 5;

/** Maximum downloaded HTML payload size (2 MB) to prevent memory exhaustion. */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** In-memory TTL cache for compiled raw recipe extractions (10 minutes). */
const RECIPE_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;
const EXTRACTED_RECIPE_CACHE = new Map<
  string,
  { expiresAt: number; recipe: ExtractedRawRecipe }
>();

/** Browser-standard User-Agent to avoid naive bot-UA blocks and 429 throttling. */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Clears the in-memory scraper URL cache (primarily for deterministic testing).
 */
export function clearScraperCacheForTests(): void {
  EXTRACTED_RECIPE_CACHE.clear();
}

function getCachedRecipe(urlKey: string): ExtractedRawRecipe | null {
  const entry = EXTRACTED_RECIPE_CACHE.get(urlKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    EXTRACTED_RECIPE_CACHE.delete(urlKey);
    return null;
  }
  return {
    ...entry.recipe,
    rawIngredients: [...entry.recipe.rawIngredients],
    rawInstructions: [...entry.recipe.rawInstructions],
  };
}

function setCachedRecipe(urlKey: string, recipe: ExtractedRawRecipe): void {
  if (EXTRACTED_RECIPE_CACHE.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = EXTRACTED_RECIPE_CACHE.keys().next().value;
    if (oldestKey !== undefined) {
      EXTRACTED_RECIPE_CACHE.delete(oldestKey);
    }
  }
  EXTRACTED_RECIPE_CACHE.set(urlKey, {
    expiresAt: Date.now() + RECIPE_CACHE_TTL_MS,
    recipe: {
      ...recipe,
      rawIngredients: [...recipe.rawIngredients],
      rawInstructions: [...recipe.rawInstructions],
    },
  });
}

/**
 * Checks whether an IPv4 dotted-quad string falls within loopback, private,
 * link-local, unspecified, or CGNAT ranges.
 */
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

/**
 * Validates that a user-submitted (or redirect target) recipe URL uses HTTP(S)
 * without embedded credentials and does not target local/private network ranges.
 */
export function validatePublicRecipeUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid recipe URL. Please enter a complete https:// or http:// URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// recipe URLs are supported.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Recipe URLs with embedded credentials are not allowed.');
  }

  const rawHost = parsed.hostname.toLowerCase();
  const host = rawHost.replace(/^\[|\]$/g, '');

  // Block single-label hosts, local domains, and non-standard integer/octal IP representations
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^\d+$/.test(host) ||
    /^0x[0-9a-f]+$/i.test(host)
  ) {
    throw new Error('Local or private network URLs cannot be fetched.');
  }

  // Block private/loopback/link-local IPv4 literals (including octal leading-zero forms)
  if (/^[\d.]+$/.test(host)) {
    if (/(?:^|\.)0\d+/.test(host) || isBlockedIpv4(host)) {
      throw new Error('Local or private network URLs cannot be fetched.');
    }
  }

  // Block loopback, ULA, link-local, and IPv4-mapped IPv6 literals
  if (host.includes(':')) {
    if (
      host === '::' ||
      host === '::1' ||
      /^::ffff:/i.test(host) ||
      /^f[cd][0-9a-f]{2}:/i.test(host) ||
      /^fe[89ab][0-9a-f]:/i.test(host)
    ) {
      throw new Error('Local or private network URLs cannot be fetched.');
    }
  }

  return parsed;
}

/**
 * Reads a Fetch `Response` stream safely with an enforced maximum byte cap.
 */
async function readTextWithSizeLimit(
  response: Response,
  maxBytes: number
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error('Recipe page exceeds the 2 MB size limit.');
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error('Recipe page exceeds the 2 MB size limit.');
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let html = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Recipe page exceeds the 2 MB size limit.');
      }
      html += decoder.decode(value, { stream: true });
    }
  }
  html += decoder.decode();
  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractXmlTagContent(xmlBlock: string, tagName: string): string {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, 'i');
  const match = xmlBlock.match(regex);
  if (!match) return '';
  let content = match[1].trim();
  const cdata = content.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) {
    content = cdata[1];
  } else if (content.startsWith('&lt;')) {
    content = content
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }
  return content.trim();
}

/**
 * Fetches a validated public URL manually following up to MAX_REDIRECT_HOPS,
 * validating every redirect target against SSRF rules.
 */
async function fetchPublicWithRedirects(
  startUrl: URL,
  signal: AbortSignal,
  acceptHeader: string
): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = startUrl;
  let response: Response | null = null;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    response = await fetch(currentUrl.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: acceptHeader,
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });

    // Validate redirect targets manually so open redirects cannot pivot into internal IPs
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Redirect response (HTTP ${response.status}) lacked a Location header.`);
      }
      if (hop === MAX_REDIRECT_HOPS) {
        throw new Error('Too many redirects while fetching recipe URL.');
      }
      const resolvedRedirect = new URL(location, currentUrl);
      currentUrl = validatePublicRecipeUrl(resolvedRedirect.toString());
      continue;
    }

    break;
  }

  if (!response) {
    throw new Error('No response received from recipe URL.');
  }

  return { response, finalUrl: currentUrl };
}

/**
 * Attempts Substack / newsletter alternative public post endpoints (`/api/v1/posts/<slug>`
 * and `/feed`) when the main HTML page returns HTTP 429, 403, or 503.
 */
async function tryAlternativePostEndpoints(
  targetUrl: URL,
  signal: AbortSignal
): Promise<ExtractedRawRecipe | null> {
  const postMatch = targetUrl.pathname.match(/^\/p\/([a-zA-Z0-9_-]+)/);
  if (!postMatch) return null;

  const slug = postMatch[1];

  // 1. Substack public JSON post endpoint
  try {
    const apiUrl = validatePublicRecipeUrl(`${targetUrl.origin}/api/v1/posts/${slug}`);
    const { response: apiRes } = await fetchPublicWithRedirects(
      apiUrl,
      signal,
      'application/json, text/plain, */*'
    );
    if (apiRes.ok) {
      const rawJson = await readTextWithSizeLimit(apiRes, MAX_RESPONSE_BYTES);
      const post = JSON.parse(rawJson) as {
        title?: string;
        subtitle?: string;
        description?: string;
        body_html?: string;
      };
      if (typeof post?.body_html === 'string' && post.body_html.trim().length > 50) {
        const title = typeof post.title === 'string' ? post.title.trim() : '';
        const subtitle =
          typeof post.subtitle === 'string'
            ? post.subtitle.trim()
            : typeof post.description === 'string'
              ? post.description.trim()
              : '';
        const syntheticHtml = `<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body><article><h1 class="post-title">${escapeHtml(title)}</h1>${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}<div class="body markup">${post.body_html}</div></article></body></html>`;
        return extractRecipeFromHtml(syntheticHtml, targetUrl.toString());
      }
    }
  } catch {
    // Continue to RSS feed fallback
  }

  // 2. RSS /feed fallback
  try {
    const feedUrl = validatePublicRecipeUrl(`${targetUrl.origin}/feed`);
    const { response: feedRes } = await fetchPublicWithRedirects(
      feedUrl,
      signal,
      'application/rss+xml, application/xml, text/xml, */*'
    );
    if (feedRes.ok) {
      const xml = await readTextWithSizeLimit(feedRes, MAX_RESPONSE_BYTES);
      const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
      const needle = `/p/${slug}`.toLowerCase();
      for (const itemXml of itemMatches) {
        const link = extractXmlTagContent(itemXml, 'link').toLowerCase();
        const guid = extractXmlTagContent(itemXml, 'guid').toLowerCase();
        if (!link.includes(needle) && !guid.includes(needle)) continue;

        const title = extractXmlTagContent(itemXml, 'title');
        const bodyHtml =
          extractXmlTagContent(itemXml, 'content:encoded') ||
          extractXmlTagContent(itemXml, 'description');
        if (bodyHtml.length > 50) {
          const syntheticHtml = `<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body><article><h1 class="post-title">${escapeHtml(title)}</h1><div class="body markup">${bodyHtml}</div></article></body></html>`;
          return extractRecipeFromHtml(syntheticHtml, targetUrl.toString());
        }
      }
    }
  } catch {
    // Fall through to caller error handling
  }

  return null;
}

/**
 * Fetches a recipe page over HTTP(S), validating every redirect hop against SSRF
 * rules and enforcing content-type and 2 MB size caps before extracting recipe fields.
 *
 * @param rawUrl - Public recipe page URL.
 * @returns ExtractedRawRecipe object.
 */
export async function fetchAndExtractRecipe(rawUrl: string): Promise<ExtractedRawRecipe> {
  const initialUrl = validatePublicRecipeUrl(rawUrl);
  const cacheKey = initialUrl.toString();
  const cached = getCachedRecipe(cacheKey);
  if (cached) {
    return cached;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 14000);

  try {
    const htmlAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    let { response, finalUrl } = await fetchPublicWithRedirects(
      initialUrl,
      controller.signal,
      htmlAccept
    );

    if (!response.ok && (response.status === 429 || response.status === 403 || response.status === 503)) {
      const recovered = await tryAlternativePostEndpoints(finalUrl, controller.signal);
      if (recovered) {
        setCachedRecipe(cacheKey, recovered);
        return recovered;
      }

      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        ({ response, finalUrl } = await fetchPublicWithRedirects(
          initialUrl,
          controller.signal,
          htmlAccept
        ));
      }
    }

    if (!response.ok) {
      if (response.status === 403 || response.status === 429 || response.status === 401) {
        throw new Error(
          `Source site blocked automated access (HTTP ${response.status}). Copy the recipe and use the "Paste Raw Recipe Text" tab instead.`
        );
      }
      throw new Error(`Unable to fetch URL (HTTP ${response.status} ${response.statusText}).`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (
      contentType &&
      !/(?:text\/html|application\/xhtml\+xml|text\/plain|application\/xml|text\/xml)/i.test(
        contentType
      )
    ) {
      throw new Error(
        `Unsupported response Content-Type "${contentType}". Expected an HTML recipe page.`
      );
    }

    const html = await readTextWithSizeLimit(response, MAX_RESPONSE_BYTES);
    if (!html || html.trim().length < 50) {
      throw new Error('Fetched page returned empty HTML content.');
    }

    const extracted = extractRecipeFromHtml(html, finalUrl.toString());
    setCachedRecipe(cacheKey, extracted);
    return extracted;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        'Request to the recipe website timed out after 14s. Try pasting the recipe into the Raw Text tab.'
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// HTML Extraction Pipeline (JSON-LD -> Microdata -> Heuristic DOM)
// ============================================================================

/**
 * Extracts structured recipe data from raw HTML markup.
 *
 * @param html - Full HTML document or fragment string.
 * @param sourceUrl - Optional origin URL for metadata provenance.
 * @returns ExtractedRawRecipe record.
 */
export function extractRecipeFromHtml(html: string, sourceUrl?: string): ExtractedRawRecipe {
  const { document } = parseHTML(html);

  let fallbackArticleTitle: string | undefined;
  let fallbackArticleDescription: string | undefined;

  // Tier 1: Search all <script type="application/ld+json"> blocks for schema.org/Recipe
  const ldScripts = Array.from(
    document.querySelectorAll('script[type*="ld+json"]')
  );
  for (const script of ldScripts) {
    const rawJson = script.textContent?.trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      const recipeNode = findRecipeJsonLdNode(parsed);
      if (recipeNode) {
        const extracted = normalizeJsonLdRecipe(recipeNode, sourceUrl);
        if (extracted.rawIngredients.length > 0 || extracted.rawInstructions.length > 0) {
          return extracted;
        }
      }

      if (!fallbackArticleTitle) {
        const articleNode = findArticleJsonLdNode(parsed);
        if (articleNode) {
          const headline = articleNode.headline ?? articleNode.name;
          if (typeof headline === 'string' && headline.trim()) {
            fallbackArticleTitle = decodeHtmlText(headline);
          }
          if (typeof articleNode.description === 'string' && articleNode.description.trim()) {
            fallbackArticleDescription = decodeHtmlText(articleNode.description).slice(0, 260);
          }
        }
      }
    } catch {
      // Ignore malformed JSON-LD script blocks and continue scanning
    }
  }

  // Tier 2: Microdata ([itemtype*="Recipe"])
  const microdataRoot = document.querySelector('[itemtype*="Recipe"]');
  if (microdataRoot) {
    const ingEls = Array.from(
      microdataRoot.querySelectorAll('[itemprop="recipeIngredient"], [itemprop="ingredients"]')
    );
    const stepEls = Array.from(
      microdataRoot.querySelectorAll('[itemprop="recipeInstructions"]')
    );

    const rawIngredients = ingEls
      .map((el) => decodeHtmlText(el.textContent || ''))
      .filter(Boolean);
    const rawInstructions = extractMicrodataSteps(stepEls);

    if (rawIngredients.length > 0 && rawInstructions.length > 0) {
      const titleEl =
        microdataRoot.querySelector('[itemprop="name"]') || document.querySelector('h1');
      const yieldEl = microdataRoot.querySelector('[itemprop="recipeYield"]');
      const yieldStr = decodeHtmlText(yieldEl?.textContent || '');
      const { servings, yieldLabel } = parseYield(yieldStr);

      return {
        title:
          decodeHtmlText(titleEl?.textContent || '') ||
          extractPageTitle(document, undefined, fallbackArticleTitle),
        sourceUrl,
        prepTime: formatIsoDuration(
          microdataRoot.querySelector('[itemprop="prepTime"]')?.getAttribute('datetime') ||
            microdataRoot.querySelector('[itemprop="prepTime"]')?.getAttribute('content')
        ),
        cookTime: formatIsoDuration(
          microdataRoot.querySelector('[itemprop="cookTime"]')?.getAttribute('datetime') ||
            microdataRoot.querySelector('[itemprop="cookTime"]')?.getAttribute('content')
        ),
        totalTime: formatIsoDuration(
          microdataRoot.querySelector('[itemprop="totalTime"]')?.getAttribute('datetime') ||
            microdataRoot.querySelector('[itemprop="totalTime"]')?.getAttribute('content')
        ),
        servings,
        yieldLabel,
        rawIngredients,
        rawInstructions,
        extractionMethod: 'microdata',
      };
    }
  }

  // Tier 3: Semantic HTML heuristic extraction
  const heuristicResult = extractSemanticHtmlRecipe(
    document,
    sourceUrl,
    fallbackArticleTitle,
    fallbackArticleDescription
  );
  if (
    heuristicResult.rawIngredients.length > 0 ||
    heuristicResult.rawInstructions.length > 0
  ) {
    return heuristicResult;
  }

  throw new Error(
    'No structured recipe was detected on that page. Please paste the recipe ingredients & steps into the "Paste Raw Recipe Text" tab.'
  );
}

// ============================================================================
// JSON-LD Traversal & Normalization Helpers
// ============================================================================

/**
 * Recursively locates the first JSON-LD object whose `@type` includes `Recipe`.
 */
function findRecipeJsonLdNode(node: unknown): Record<string, unknown> | null {
  return findTypedJsonLdNode(node, /(?:^|\/)Recipe$/i);
}

/**
 * Recursively locates an Article / NewsArticle / BlogPosting JSON-LD node for fallback metadata.
 */
function findArticleJsonLdNode(node: unknown): Record<string, unknown> | null {
  return findTypedJsonLdNode(node, /(?:^|\/)(?:NewsArticle|Article|BlogPosting)$/i);
}

function findTypedJsonLdNode(
  node: unknown,
  typeRegex: RegExp
): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findTypedJsonLdNode(item, typeRegex);
      if (found) return found;
    }
    return null;
  }

  const record = node as Record<string, unknown>;
  const rawType = record['@type'];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  const matchesType = types.some(
    (t) => typeof t === 'string' && typeRegex.test(t.trim())
  );
  if (matchesType) {
    return record;
  }

  // Search @graph or nested properties (e.g., mainEntity)
  if (Array.isArray(record['@graph'])) {
    const found = findTypedJsonLdNode(record['@graph'], typeRegex);
    if (found) return found;
  }
  if (record.mainEntity) {
    const found = findTypedJsonLdNode(record.mainEntity, typeRegex);
    if (found) return found;
  }

  return null;
}

/**
 * Converts a schema.org/Recipe JSON-LD object into an ExtractedRawRecipe.
 */
function normalizeJsonLdRecipe(
  recipe: Record<string, unknown>,
  sourceUrl?: string
): ExtractedRawRecipe {
  const title = decodeHtmlText(String(recipe.name || 'Untitled Recipe'));
  const description = recipe.description
    ? decodeHtmlText(String(recipe.description)).slice(0, 260)
    : undefined;

  const rawIngSource = Array.isArray(recipe.recipeIngredient)
    ? recipe.recipeIngredient
    : Array.isArray(recipe.ingredients)
      ? recipe.ingredients
      : typeof recipe.recipeIngredient === 'string'
        ? recipe.recipeIngredient.split('\n')
        : [];

  const rawIngredients = rawIngSource
    .map((item) => decodeHtmlText(String(item)))
    .filter((line) => line.length > 0);

  const rawInstructions = flattenJsonLdInstructions(recipe.recipeInstructions);
  const { servings, yieldLabel } = parseYield(recipe.recipeYield);

  return {
    title,
    description,
    sourceUrl,
    prepTime: formatIsoDuration(recipe.prepTime),
    cookTime: formatIsoDuration(recipe.cookTime),
    totalTime: formatIsoDuration(recipe.totalTime),
    servings,
    yieldLabel,
    rawIngredients,
    rawInstructions,
    extractionMethod: 'json-ld',
  };
}

/**
 * Flattens string, HowToStep, and nested HowToSection arrays into clean step strings.
 */
function flattenJsonLdInstructions(instructions: unknown): string[] {
  const steps: string[] = [];

  const visit = (item: unknown): void => {
    if (!item) return;

    if (typeof item === 'string') {
      // Split multi-line instruction blobs into individual steps
      const splitLines = item
        .split(/\n+/)
        .map((s) => decodeHtmlText(s).replace(/^\d+[.)]\s*/, '').trim())
        .filter((s) => s.length > 2);
      steps.push(...splitLines);
      return;
    }

    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child);
      }
      return;
    }

    if (typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (Array.isArray(obj.itemListElement)) {
        for (const sub of obj.itemListElement) {
          visit(sub);
        }
        return;
      }
      const text = obj.text ?? obj.name ?? obj.description;
      if (typeof text === 'string') {
        const cleaned = decodeHtmlText(text).replace(/^\d+[.)]\s*/, '').trim();
        if (cleaned.length > 2) {
          steps.push(cleaned);
        }
      }
    }
  };

  visit(instructions);
  return steps;
}

// ============================================================================
// Microdata & Semantic HTML Fallback Helpers
// ============================================================================

/**
 * Extracts step strings from Microdata `[itemprop="recipeInstructions"]` nodes.
 */
function extractMicrodataSteps(stepEls: Array<{ textContent: string | null; querySelectorAll: (sel: string) => Iterable<{ textContent: string | null }> }>): string[] {
  const steps: string[] = [];
  for (const el of stepEls) {
    const liNodes = Array.from(el.querySelectorAll('li, [itemprop="text"]'));
    if (liNodes.length > 0) {
      for (const li of liNodes) {
        const text = decodeHtmlText(li.textContent || '').replace(/^\d+[.)]\s*/, '').trim();
        if (text.length > 2) steps.push(text);
      }
    } else {
      const text = decodeHtmlText(el.textContent || '').replace(/^\d+[.)]\s*/, '').trim();
      if (text.length > 2) {
        steps.push(...text.split(/\n+/).map((s) => s.trim()).filter(Boolean));
      }
    }
  }
  return steps;
}

/** Noise selectors removed from cloned/parsed DOM before heuristic extraction. */
const SCRAPER_NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'nav',
  'footer',
  'aside',
  'form',
  'svg',
  'button',
  '.subscribe-widget',
  '.button-wrapper',
  '.header-anchor-parent',
  '.comments-page',
  '.discussion',
  '.post-footer',
  '[data-component-name*="Button"]',
  '[data-component-name*="Subscribe"]',
];

/**
 * Checks whether a single text line looks like a culinary ingredient line
 * rather than narrative prose or a numbered instruction step.
 */
function isIngredientLikeLine(rawText: string): boolean {
  const trimmed = rawText.replace(/^[-*•☐]\s*/, '').replace(/\s+/g, ' ').trim();
  if (trimmed.length < 3 || trimmed.length > 180) return false;

  // Reject numbered instructions like "1. Heat the oven to 350F..."
  if (/^\d+[.)]\s+[A-Z]/.test(trimmed) && trimmed.length > 25) return false;
  // Reject bare 4-digit years or pure numbers
  if (/^\d{4}\b/.test(trimmed) || /^\d+$/.test(trimmed)) return false;

  // Strip parenthetical tasting/substitution remarks before checking prose length
  const core = trimmed.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!core || (core.length > 125 && /[.!?]\s+[A-Z]/.test(core))) return false;

  const qtyPrefix =
    /^(?:(?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:\.\d+)?)|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])(?:\s*(?:-|–|to)\s*(?:(?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:\.\d+)?)|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]))?/u;
  const qtyMatch = core.match(qtyPrefix);
  if (qtyMatch) {
    const afterQty = core.slice(qtyMatch[0].length);
    if (!afterQty) return false;
    // Reject time/temperature durations or numbered step delimiters
    if (/^[.)]/.test(afterQty.trim())) return false;
    if (/^\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|degrees?|°[FC])\b/i.test(afterQty)) {
      return false;
    }
    if (
      /^(?:g|kg|mg|oz|fl\.?\s*oz|lb|lbs|ml|l|cups?|c|tbsp|tbs|tsp|teaspoons?|tablespoons?|cans?|cloves?|pinch(?:es)?|dash(?:es)?|slices?|pieces?|heads?|stalks?|sheets?|strips?|drops?|sticks?|pkg|packages?|bunches?|sprigs?|large|medium|small)\b/i.test(
        afterQty.trim()
      )
    ) {
      return true;
    }
    if (/^\s+\S/.test(afterQty) && core.length <= 95) {
      return true;
    }
  }

  if (
    /^(?:a|an)\s+(?:pinch|dash|handful|bunch|sprig|clove|can|splash|drizzle|few|couple)\b/i.test(
      core
    )
  ) {
    return true;
  }

  if (
    /^(?:kosher\s+salt|sea\s+salt|flaky\s+salt|fine\s+salt|salt\s+and\s+(?:black\s+)?pepper|freshly\s+ground\s+(?:black\s+)?pepper|black\s+pepper|olive\s+oil|cooking\s+spray)\b/i.test(
      core
    ) ||
    /\b(?:to taste|as needed|for garnish|for serving)\s*$/i.test(core)
  ) {
    return true;
  }

  return false;
}

/**
 * Selects the primary article/recipe DOM container if available.
 */
function selectMainContentRoot(document: ReturnType<typeof parseHTML>['document']) {
  return (
    document.querySelector(
      '.body.markup, .post-content, .entry-content, .article-content, [itemprop="articleBody"], article, main'
    ) || document.body
  );
}

/**
 * Extracts newline-preserving lines from a DOM container for raw-text parsing
 * and AI fallback excerpts.
 */
function extractStructuredLinesFromDom(root: unknown): string[] {
  const lines: string[] = [];
  const blockTags = new Set([
    'P',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'LI',
    'BLOCKQUOTE',
    'TR',
  ]);
  const containerTags = new Set([
    'DIV',
    'SECTION',
    'ARTICLE',
    'MAIN',
    'UL',
    'OL',
    'BODY',
    'HEADER',
  ]);

  interface DomNodeLike {
    nodeType?: number;
    tagName?: string;
    textContent?: string | null;
    childNodes?: ArrayLike<DomNodeLike>;
  }

  const pushBuffer = (buf: string) => {
    const cleaned = decodeHtmlText(buf);
    if (cleaned.length > 0) {
      lines.push(cleaned);
    }
  };

  let inlineBuf = '';
  const walk = (node: DomNodeLike | null | undefined): void => {
    if (!node) return;
    // Text node (3)
    if (node.nodeType === 3) {
      inlineBuf += node.textContent || '';
      return;
    }
    const tag = (node.tagName || '').toUpperCase();
    if (tag === 'BR' || tag === 'HR') {
      pushBuffer(inlineBuf);
      inlineBuf = '';
      return;
    }
    if (blockTags.has(tag)) {
      pushBuffer(inlineBuf);
      inlineBuf = '';
      const children = node.childNodes ? Array.from(node.childNodes) : [];
      const hasNestedBlocks = children.some(
        (c) => blockTags.has((c.tagName || '').toUpperCase()) || containerTags.has((c.tagName || '').toUpperCase())
      );
      if (!hasNestedBlocks) {
        pushBuffer(node.textContent || '');
        return;
      }
      for (const child of children) {
        walk(child);
      }
      pushBuffer(inlineBuf);
      inlineBuf = '';
      return;
    }
    if (containerTags.has(tag)) {
      pushBuffer(inlineBuf);
      inlineBuf = '';
      const children = node.childNodes ? Array.from(node.childNodes) : [];
      for (const child of children) {
        walk(child);
      }
      pushBuffer(inlineBuf);
      inlineBuf = '';
      return;
    }

    const children = node.childNodes ? Array.from(node.childNodes) : [];
    if (children.length === 0 && node.textContent) {
      inlineBuf += node.textContent;
      return;
    }
    for (const child of children) {
      walk(child);
    }
  };

  walk(root as DomNodeLike);
  pushBuffer(inlineBuf);
  return lines;
}

/**
 * Builds a compact newline-delimited excerpt focused on the recipe portion
 * of a long blog post so Workers AI sees ingredients & steps without token overflow.
 */
function buildRawBodyExcerpt(lines: string[], maxChars = 5500): string {
  if (lines.length === 0) return '';
  const full = lines.join('\n');
  if (full.length <= maxChars) return full;

  let anchorIdx = lines.findIndex((line) =>
    /^(?:ingredients?|for the (?:crust|filling|dough|batter|sauce|topping|cream)|.*recipe$)/i.test(
      line.trim()
    )
  );
  if (anchorIdx === -1) {
    anchorIdx = lines.findIndex((line) => isIngredientLikeLine(line));
  }

  if (anchorIdx > 0) {
    const startIdx = Math.max(0, anchorIdx - 4);
    let excerpt = '';
    for (let i = startIdx; i < lines.length; i += 1) {
      const next = excerpt ? `${excerpt}\n${lines[i]}` : lines[i];
      if (next.length > maxChars) break;
      excerpt = next;
    }
    if (excerpt.length > 200) return excerpt;
  }

  return full.slice(-maxChars);
}

/**
 * Scans semantic headings, multi-component ingredient lists, and instruction
 * blocks in a generic HTML page when schema.org Recipe annotations are absent.
 */
function extractSemanticHtmlRecipe(
  document: ReturnType<typeof parseHTML>['document'],
  sourceUrl?: string,
  fallbackArticleTitle?: string,
  fallbackArticleDescription?: string
): ExtractedRawRecipe {
  for (const sel of SCRAPER_NOISE_SELECTORS) {
    for (const el of Array.from(document.querySelectorAll(sel))) {
      el.remove();
    }
  }

  const contentRoot = selectMainContentRoot(document);
  let title = extractPageTitle(document, contentRoot, fallbackArticleTitle);
  let description = fallbackArticleDescription;
  let servings = 4;
  let yieldLabel = '4 servings';
  let prepTime: string | undefined;
  let cookTime: string | undefined;
  let totalTime: string | undefined;

  const structuredLines = extractStructuredLinesFromDom(contentRoot || document.body);
  const rawBodyExcerpt = buildRawBodyExcerpt(structuredLines);

  // Pass 1: Explicit "Ingredients" and "Instructions/Directions/Method/Steps" headings
  const rawIngredients: string[] = [];
  const rawInstructions: string[] = [];
  const searchScope = contentRoot || document;
  const headings = Array.from(searchScope.querySelectorAll('h1, h2, h3, h4, h5, h6'));

  for (const heading of headings) {
    const label = decodeHtmlText(heading.textContent || '').trim();
    if (!label || label.length > 80) continue;

    if (/\bingredients?\b/i.test(label) && rawIngredients.length === 0) {
      rawIngredients.push(...collectSectionItems(heading, 'ingredients'));
    } else if (
      /\b(?:instructions?|directions?|method|steps?|preparation|procedure)\b/i.test(label) &&
      rawInstructions.length === 0
    ) {
      rawInstructions.push(...collectSectionItems(heading, 'instructions'));
    }
  }

  if (rawIngredients.length > 0 && rawInstructions.length > 0) {
    return {
      title,
      description,
      sourceUrl,
      prepTime,
      cookTime,
      totalTime,
      servings,
      yieldLabel,
      rawIngredients,
      rawInstructions,
      rawBodyExcerpt,
      extractionMethod: 'html-heuristic',
    };
  }

  // Pass 2: Substack & narrative food blog multi-component pattern
  // Detect clustered <ul> ingredient lists followed by instruction paragraphs/<ol>
  const implicitResult = extractImplicitBlogRecipe(searchScope);
  if (
    implicitResult &&
    (implicitResult.rawIngredients.length > 0 || implicitResult.rawInstructions.length > 0)
  ) {
    if (implicitResult.recipeTitle) {
      title = implicitResult.recipeTitle;
    }
    if (implicitResult.recipeDescription) {
      description = implicitResult.recipeDescription;
    }
    if (implicitResult.yieldLabel) {
      yieldLabel = implicitResult.yieldLabel;
      servings = implicitResult.servings;
    }
    if (implicitResult.prepTime) prepTime = implicitResult.prepTime;
    if (implicitResult.cookTime) cookTime = implicitResult.cookTime;
    if (implicitResult.totalTime) totalTime = implicitResult.totalTime;

    return {
      title,
      description,
      sourceUrl,
      prepTime,
      cookTime,
      totalTime,
      servings,
      yieldLabel,
      rawIngredients:
        rawIngredients.length > 0 ? rawIngredients : implicitResult.rawIngredients,
      rawInstructions:
        rawInstructions.length > 0 ? rawInstructions : implicitResult.rawInstructions,
      rawBodyExcerpt,
      extractionMethod: 'html-heuristic',
    };
  }

  // If Pass 1 found partial ingredients or instructions, still return them
  if (rawIngredients.length > 0 || rawInstructions.length > 0) {
    return {
      title,
      description,
      sourceUrl,
      prepTime,
      cookTime,
      totalTime,
      servings,
      yieldLabel,
      rawIngredients,
      rawInstructions,
      rawBodyExcerpt,
      extractionMethod: 'html-heuristic',
    };
  }

  // Pass 3: Line-preserving raw text extraction from stripped content body
  const bodyLinesText = structuredLines.join('\n');
  const rawParsed = extractRecipeFromRawText(`${title}\n${bodyLinesText}`);
  return {
    ...rawParsed,
    title: rawParsed.title !== 'Untitled Recipe Spec' ? rawParsed.title : title,
    description: rawParsed.description ?? description,
    sourceUrl,
    rawBodyExcerpt,
    extractionMethod: 'html-heuristic',
  };
}

/**
 * Collects list items or paragraphs following an explicit Ingredients or
 * Instructions heading, spanning component subheadings like "For the crust:".
 */
function collectSectionItems(
  heading: { nextElementSibling: unknown },
  mode: 'ingredients' | 'instructions'
): string[] {
  const results: string[] = [];
  let cursor = heading.nextElementSibling as {
    tagName?: string;
    textContent: string | null;
    querySelectorAll?: (sel: string) => Iterable<{ textContent: string | null }>;
    nextElementSibling?: unknown;
  } | null;

  const maxHops = mode === 'ingredients' ? 16 : 24;
  let hops = 0;

  while (cursor && hops < maxHops) {
    const tag = (cursor.tagName || '').toUpperCase();
    const rawText = decodeHtmlText(cursor.textContent || '').trim();

    if (/^H[1-6]$/.test(tag)) {
      if (mode === 'ingredients') {
        // Stop at instructions heading or major unrelated heading; allow component subheadings
        if (
          /\b(?:instructions?|directions?|method|steps?|preparation|procedure)\b/i.test(rawText) ||
          (/^H[1-4]$/.test(tag) && !/^for\s+the\b|\bingredients?\b/i.test(rawText))
        ) {
          break;
        }
      } else {
        if (
          /^(?:notes?|tips?|nutrition|comments?|discussion|restacks?|ready for more|subscribe|leave a comment|but if you want)\b/i.test(
            rawText
          )
        ) {
          break;
        }
      }
      cursor = (cursor.nextElementSibling as typeof cursor) || null;
      hops += 1;
      continue;
    }

    if (tag === 'UL' || tag === 'OL') {
      const items = cursor.querySelectorAll ? Array.from(cursor.querySelectorAll('li')) : [];
      for (const li of items) {
        const text = decodeHtmlText(li.textContent || '')
          .replace(/^\d+[.)]\s*/, '')
          .trim();
        if (text.length > 1) results.push(text);
      }
    } else if (tag === 'DIV' && cursor.querySelectorAll) {
      const items = Array.from(cursor.querySelectorAll('li'));
      if (items.length > 0) {
        for (const li of items) {
          const text = decodeHtmlText(li.textContent || '')
            .replace(/^\d+[.)]\s*/, '')
            .trim();
          if (text.length > 1) results.push(text);
        }
      } else if (mode === 'instructions') {
        const paras = Array.from(cursor.querySelectorAll('p'));
        for (const p of paras) {
          const pText = decodeHtmlText(p.textContent || '').trim();
          if (pText.length > 8) pushOrMergeInstructionStep(results, pText);
        }
      }
    } else if (tag === 'P') {
      if (mode === 'ingredients') {
        // Stop if we encounter an inline bold instruction paragraph like "Make the crust:"
        if (/^(?:make|to make|prepare|bake|assemble|instructions?|directions?)\b.*:/i.test(rawText) && rawText.length > 40) {
          break;
        }
        // Skip short component sublabels like "For the crust:"
        if (!/^for\s+the\s+.+:$/i.test(rawText) && isIngredientLikeLine(rawText)) {
          results.push(rawText);
        }
      } else if (rawText.length > 8) {
        pushOrMergeInstructionStep(results, rawText);
      }
    }

    cursor = (cursor.nextElementSibling as typeof cursor) || null;
    hops += 1;
  }

  return results;
}

/**
 * Extracts multi-component recipe lists and following instruction paragraphs
 * from Substack / newsletter / blog layouts without schema.org Recipe markup.
 */
function extractImplicitBlogRecipe(scope: {
  querySelectorAll: (sel: string) => Iterable<unknown>;
}): {
  recipeTitle?: string;
  recipeDescription?: string;
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  servings: number;
  yieldLabel?: string;
  rawIngredients: string[];
  rawInstructions: string[];
} | null {
  interface ElementLike {
    tagName?: string;
    textContent: string | null;
    previousElementSibling?: ElementLike | null;
    nextElementSibling?: ElementLike | null;
    parentElement?: ElementLike | null;
    querySelectorAll?: (sel: string) => Iterable<ElementLike>;
    getAttribute?: (name: string) => string | null;
  }

  const allUls = Array.from(scope.querySelectorAll('ul')) as ElementLike[];
  interface CandidateUl {
    ul: ElementLike;
    items: string[];
  }
  const qualifyingUls: CandidateUl[] = [];

  for (const ul of allUls) {
    const liEls = ul.querySelectorAll ? Array.from(ul.querySelectorAll('li')) : [];
    const items = liEls
      .map((li) => decodeHtmlText(li.textContent || '').trim())
      .filter((t) => t.length > 1);
    if (items.length < 2) continue;

    const ingCount = items.filter((t) => isIngredientLikeLine(t)).length;
    const ratio = ingCount / items.length;

    // Check immediate previous non-empty sibling for a "For the <component>:" cue
    let prev = ul.previousElementSibling || null;
    let prevHops = 0;
    let hasComponentLabel = false;
    while (prev && prevHops < 3) {
      const pText = decodeHtmlText(prev.textContent || '').trim();
      if (pText.length > 0) {
        hasComponentLabel = /^(?:for\s+the\s+.+|.+ingredients?):?$/i.test(pText);
        break;
      }
      prev = prev.previousElementSibling || null;
      prevHops += 1;
    }

    if (ratio >= 0.6 || (hasComponentLabel && ratio >= 0.45)) {
      qualifyingUls.push({ ul, items });
    }
  }

  if (qualifyingUls.length === 0) {
    return null;
  }

  // Group qualifying <ul> blocks that belong to the same recipe card
  const clusters: CandidateUl[][] = [[qualifyingUls[0]]];
  for (let i = 1; i < qualifyingUls.length; i += 1) {
    const prevUl = qualifyingUls[i - 1].ul;
    const currUl = qualifyingUls[i].ul;

    let sameCluster = false;
    let cursor = prevUl.nextElementSibling || null;
    let distance = 0;
    let proseChars = 0;
    while (cursor && distance < 6) {
      if (cursor === currUl) {
        sameCluster = proseChars < 240;
        break;
      }
      const cText = decodeHtmlText(cursor.textContent || '').trim();
      const cTag = (cursor.tagName || '').toUpperCase();
      if (cTag === 'P' && !/^for\s+the\s+.+:$/i.test(cText)) {
        proseChars += cText.length;
      }
      cursor = cursor.nextElementSibling || null;
      distance += 1;
    }

    if (sameCluster) {
      clusters[clusters.length - 1].push(qualifyingUls[i]);
    } else {
      clusters.push([qualifyingUls[i]]);
    }
  }

  // Prefer the cluster with the most ingredient items (tie-break: later cluster after essay)
  let bestCluster = clusters[0];
  let bestCount = bestCluster.reduce((sum, entry) => sum + entry.items.length, 0);
  for (let i = 1; i < clusters.length; i += 1) {
    const count = clusters[i].reduce((sum, entry) => sum + entry.items.length, 0);
    if (count >= bestCount) {
      bestCluster = clusters[i];
      bestCount = count;
    }
  }

  const rawIngredients = bestCluster.flatMap((entry) => entry.items);

  // Walk backward from the first <ul> in the cluster for dedicated recipe title, summary, and yield/times
  let recipeTitle: string | undefined;
  let recipeDescription: string | undefined;
  let prepTime: string | undefined;
  let cookTime: string | undefined;
  let totalTime: string | undefined;
  let servings = 4;
  let yieldLabel: string | undefined;

  let backCursor = bestCluster[0].ul.previousElementSibling || null;
  let backHops = 0;
  const candidateDescriptions: string[] = [];

  while (backCursor && backHops < 10) {
    const tag = (backCursor.tagName || '').toUpperCase();
    const text = decodeHtmlText(backCursor.textContent || '').trim();

    if (text) {
      const prepMatch = text.match(/^prep(?:\s*time)?:\s*(.+)$/i);
      if (prepMatch && !prepTime) prepTime = prepMatch[1].trim();
      const cookMatch = text.match(/^cook(?:\s*time)?:\s*(.+)$/i);
      if (cookMatch && !cookTime) cookTime = cookMatch[1].trim();
      const totalMatch = text.match(/^total(?:\s*time)?:\s*(.+)$/i);
      if (totalMatch && !totalTime) totalTime = totalMatch[1].trim();
      const yieldMatch = text.match(/^(?:yield|servings?|makes?):\s*(.+)$/i);
      if (yieldMatch && !yieldLabel) {
        const parsedYield = parseYield(yieldMatch[1].trim());
        servings = parsedYield.servings;
        yieldLabel = parsedYield.yieldLabel;
      }

      if (/^H[1-4]$/.test(tag) && !/^for\s+the\s+.+:?$/i.test(text) && !/\bingredients?\b/i.test(text)) {
        if (text.length >= 4 && text.length < 115 && !/^(?:keep scrolling|scroll down)/i.test(text)) {
          recipeTitle = text;
          break;
        }
      } else if (tag === 'P' && text.length >= 12 && text.length <= 300 && !/^for\s+the\s+/i.test(text)) {
        if (!/^(?:prep|cook|total|yield|servings?|makes?)\b/i.test(text)) {
          candidateDescriptions.unshift(text);
        }
      }
    }

    backCursor = backCursor.previousElementSibling || null;
    backHops += 1;
  }

  if (recipeTitle && candidateDescriptions.length > 0) {
    recipeDescription = candidateDescriptions[0].slice(0, 260);
  }

  // Walk forward after the last <ul> in the cluster to collect instruction steps
  const rawInstructions: string[] = [];
  const lastUl = bestCluster[bestCluster.length - 1].ul;
  let fwdCursor: ElementLike | null = lastUl.nextElementSibling || null;
  if (!fwdCursor && lastUl.parentElement) {
    fwdCursor = lastUl.parentElement.nextElementSibling || null;
  }

  let fwdHops = 0;
  while (fwdCursor && fwdHops < 60) {
    const tag = (fwdCursor.tagName || '').toUpperCase();
    const text = decodeHtmlText(fwdCursor.textContent || '').trim();

    if (/^H[1-6]$/.test(tag)) {
      if (
        /^(?:discussion|comments?|restacks?|ready for more|subscribe|more recipes|related|leave a comment|but if you want|notes?)\b/i.test(
          text
        )
      ) {
        break;
      }
      fwdCursor = fwdCursor.nextElementSibling || null;
      fwdHops += 1;
      continue;
    }

    if (
      /^(?:leave a comment|discussion about this post|ready for more\?|©\s*\d{4}\s+)/i.test(
        text
      )
    ) {
      break;
    }

    if (tag === 'OL' || tag === 'UL') {
      const items = fwdCursor.querySelectorAll ? Array.from(fwdCursor.querySelectorAll('li')) : [];
      for (const li of items) {
        const liText = decodeHtmlText(li.textContent || '')
          .replace(/^\d+[.)]\s*/, '')
          .trim();
        if (liText.length > 8) {
          pushOrMergeInstructionStep(rawInstructions, liText);
        }
      }
    } else if (tag === 'DIV') {
      const listItems = fwdCursor.querySelectorAll ? Array.from(fwdCursor.querySelectorAll('li')) : [];
      const paras = fwdCursor.querySelectorAll ? Array.from(fwdCursor.querySelectorAll('p')) : [];
      if (listItems.length > 0) {
        for (const li of listItems) {
          const liText = decodeHtmlText(li.textContent || '')
            .replace(/^\d+[.)]\s*/, '')
            .trim();
          if (liText.length > 8) pushOrMergeInstructionStep(rawInstructions, liText);
        }
      } else if (paras.length > 0) {
        for (const p of paras) {
          const pText = decodeHtmlText(p.textContent || '').trim();
          if (shouldKeepInstructionParagraph(pText)) {
            pushOrMergeInstructionStep(rawInstructions, pText);
          }
        }
      }
    } else if (tag === 'P') {
      if (shouldKeepInstructionParagraph(text)) {
        pushOrMergeInstructionStep(rawInstructions, text);
      }
    }

    fwdCursor = fwdCursor.nextElementSibling || null;
    fwdHops += 1;
  }

  return {
    recipeTitle,
    recipeDescription,
    prepTime,
    cookTime,
    totalTime,
    servings,
    yieldLabel,
    rawIngredients,
    rawInstructions,
  };
}

function shouldKeepInstructionParagraph(text: string): boolean {
  if (text.length <= 10) return false;
  if (/^(?:share|subscribe|leave a comment|restack|\d+)$/i.test(text)) return false;
  if (/^(?:prep|cook|total)(?:\s*time)?:\s*/i.test(text) && text.length < 40) return false;
  if (/^(?:yield|servings?|makes?):\s*/i.test(text) && text.length < 40) return false;
  return true;
}

/**
 * Appends parenthetical side-note paragraphs (e.g., "(Alternatively...)") onto
 * the preceding step instead of inflating the TRN action graph with extra rows.
 */
function pushOrMergeInstructionStep(steps: string[], rawStep: string): void {
  const cleaned = rawStep.replace(/^\d+[.)]\s*/, '').trim();
  if (!cleaned) return;
  if (
    steps.length > 0 &&
    /^\([^)]+\)$/.test(cleaned)
  ) {
    steps[steps.length - 1] = `${steps[steps.length - 1]} ${cleaned}`;
    return;
  }
  steps.push(cleaned);
}

// ============================================================================
// Formatting & Entity Decoding Utilities
// ============================================================================

/**
 * Extracts a clean recipe title from inline recipe headings, post-title
 * elements, JSON-LD Article metadata, OpenGraph tags, or `<title>`.
 */
function extractPageTitle(
  document: ReturnType<typeof parseHTML>['document'],
  contentRoot?: ReturnType<ReturnType<typeof parseHTML>['document']['querySelector']>,
  fallbackArticleTitle?: string
): string {
  const scope = contentRoot || document;

  // 1. Explicit recipe heading inside article body (e.g. "A Very Good & Very Easy Pumpkin Pie Recipe")
  const inlineHeadings = Array.from(scope.querySelectorAll('h1, h2, h3'));
  for (const h of inlineHeadings) {
    const text = decodeHtmlText(h.textContent || '');
    if (
      text.length > 4 &&
      text.length < 110 &&
      /\brecipe\b/i.test(text) &&
      !/^(?:keep scrolling|scroll down)/i.test(text)
    ) {
      return text;
    }
  }

  // 2. Post-title element (Substack, WordPress, Medium)
  const postTitle = decodeHtmlText(
    document.querySelector('h1.post-title, [class*="post-title"], h1.entry-title')?.textContent || ''
  );
  if (postTitle && postTitle.length < 120) return postTitle;

  // 3. Article JSON-LD headline
  if (fallbackArticleTitle && fallbackArticleTitle.length < 120) {
    return fallbackArticleTitle;
  }

  // 4. OpenGraph og:title meta tag
  const ogTitle = decodeHtmlText(
    document.querySelector('meta[property="og:title"]')?.getAttribute('content') || ''
  );
  if (ogTitle && ogTitle.length < 120) {
    const cleanedOg = ogTitle.split(/\s+(?:[|\-–—]\s+by\s+|[|\-–—]\s+)/i)[0]?.trim();
    if (cleanedOg) return cleanedOg;
  }

  // 5. H1 inside contentRoot or first non-masthead H1
  if (contentRoot) {
    const bodyH1 = decodeHtmlText(contentRoot.querySelector('h1')?.textContent || '');
    if (bodyH1 && bodyH1.length < 120) return bodyH1;
  }
  for (const h1 of Array.from(document.querySelectorAll('h1'))) {
    const cls = h1.getAttribute?.('class') || '';
    if (/(?:pub-headings|masthead|site-title|logo|brand)/i.test(cls)) continue;
    const text = decodeHtmlText(h1.textContent || '');
    if (text && text.length < 120) return text;
  }

  // 6. <title> tag fallback
  const titleTag = decodeHtmlText(document.querySelector('title')?.textContent || '');
  return (
    titleTag.split(/\s+(?:[|\-–—]\s+by\s+|[|\-–—]\s+)/i)[0]?.trim() ||
    'Extracted Recipe Spec'
  );
}

/**
 * Decodes common HTML entities and strips residual tags/excess whitespace.
 */
function decodeHtmlText(input: string): string {
  const named: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&deg;': '°',
    '&frac12;': '1/2',
    '&frac13;': '1/3',
    '&frac23;': '2/3',
    '&frac14;': '1/4',
    '&frac34;': '3/4',
    '&ndash;': '-',
    '&mdash;': '-',
  };

  let out = input.replace(/<[^>]+>/g, ' ');
  out = out.replace(/&#(\d+);/g, (_m, dec: string) =>
    String.fromCharCode(Number(dec))
  );
  out = out.replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  for (const [entity, replacement] of Object.entries(named)) {
    out = out.replace(new RegExp(entity, 'gi'), replacement);
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Converts an ISO-8601 duration (e.g., "PT1H25M") into readable text ("1 hr 25 min").
 */
export function formatIsoDuration(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const isoMatch = trimmed.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!isoMatch) return trimmed;

  const days = isoMatch[1] ? Number(isoMatch[1]) : 0;
  const hours = isoMatch[2] ? Number(isoMatch[2]) : 0;
  const mins = isoMatch[3] ? Number(isoMatch[3]) : 0;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} d`);
  if (hours > 0) parts.push(`${hours} hr`);
  if (mins > 0) parts.push(`${mins} min`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Parses `recipeYield` (string, number, or array) into numeric servings and label.
 */
function parseYield(rawYield: unknown): { servings: number; yieldLabel: string } {
  let label = '';
  if (Array.isArray(rawYield) && rawYield.length > 0) {
    label = decodeHtmlText(String(rawYield[0]));
  } else if (typeof rawYield === 'string' || typeof rawYield === 'number') {
    label = decodeHtmlText(String(rawYield));
  }

  if (!label) {
    return { servings: 4, yieldLabel: '4 servings' };
  }

  const numMatch = label.match(/(\d+(?:\.\d+)?)/);
  const servings = numMatch ? Math.max(1, Math.round(Number(numMatch[1]))) : 4;
  const finalLabel = /^\d+$/.test(label.trim()) ? `${label.trim()} servings` : label;
  return { servings, yieldLabel: finalLabel };
}
