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

/**
 * Fetches a recipe page over HTTP(S), validating every redirect hop against SSRF
 * rules and enforcing content-type and 2 MB size caps before extracting recipe fields.
 *
 * @param rawUrl - Public recipe page URL.
 * @returns ExtractedRawRecipe object.
 */
export async function fetchAndExtractRecipe(rawUrl: string): Promise<ExtractedRawRecipe> {
  let currentUrl = validatePublicRecipeUrl(rawUrl);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    let response: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      response = await fetch(currentUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; UnfluffRecipes/1.0; +https://unfluffrecipes.workers.dev)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
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

    return extractRecipeFromHtml(html, currentUrl.toString());
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        'Request to the recipe website timed out after 12s. Try pasting the recipe into the Raw Text tab.'
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
        title: decodeHtmlText(titleEl?.textContent || '') || extractPageTitle(document),
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
  const heuristicResult = extractSemanticHtmlRecipe(document, sourceUrl);
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
  if (!node || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeJsonLdNode(item);
      if (found) return found;
    }
    return null;
  }

  const record = node as Record<string, unknown>;
  const rawType = record['@type'];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  const isRecipe = types.some(
    (t) => typeof t === 'string' && /(?:^|\/)Recipe$/i.test(t.trim())
  );
  if (isRecipe) {
    return record;
  }

  // Search @graph or nested properties (e.g., mainEntity)
  if (Array.isArray(record['@graph'])) {
    const found = findRecipeJsonLdNode(record['@graph']);
    if (found) return found;
  }
  if (record.mainEntity) {
    const found = findRecipeJsonLdNode(record.mainEntity);
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

/**
 * Scans semantic headings and lists in a generic HTML page when schema.org
 * annotations are absent.
 */
function extractSemanticHtmlRecipe(
  document: ReturnType<typeof parseHTML>['document'],
  sourceUrl?: string
): ExtractedRawRecipe {
  // Remove noisy navigation, script, and ad containers
  const noiseSelectors = ['script', 'style', 'noscript', 'nav', 'footer', 'aside'];
  for (const sel of noiseSelectors) {
    for (const el of Array.from(document.querySelectorAll(sel))) {
      el.remove();
    }
  }

  const title = extractPageTitle(document);
  const rawIngredients: string[] = [];
  const rawInstructions: string[] = [];

  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
  for (const heading of headings) {
    const label = decodeHtmlText(heading.textContent || '').toLowerCase();
    const nextList = findNextListOrParagraphs(heading);

    if (/ingredients?/i.test(label) && rawIngredients.length === 0) {
      rawIngredients.push(...nextList);
    } else if (/(?:instructions?|directions?|method|steps?)/i.test(label) && rawInstructions.length === 0) {
      rawInstructions.push(...nextList);
    }
  }

  if (rawIngredients.length > 0 || rawInstructions.length > 0) {
    return {
      title,
      sourceUrl,
      servings: 4,
      yieldLabel: '4 servings',
      rawIngredients,
      rawInstructions,
      extractionMethod: 'html-heuristic',
    };
  }

  // Last-resort raw text extraction from stripped document body
  const bodyText = decodeHtmlText(document.body?.textContent || '');
  const rawParsed = extractRecipeFromRawText(`${title}\n${bodyText}`);
  return {
    ...rawParsed,
    sourceUrl,
    extractionMethod: 'html-heuristic',
  };
}

/**
 * Finds list items or consecutive paragraphs immediately following a section heading.
 */
function findNextListOrParagraphs(heading: { nextElementSibling: unknown }): string[] {
  const results: string[] = [];
  let cursor = heading.nextElementSibling as {
    tagName?: string;
    textContent: string | null;
    querySelectorAll?: (sel: string) => Iterable<{ textContent: string | null }>;
    nextElementSibling?: unknown;
  } | null;

  let hops = 0;
  while (cursor && hops < 6) {
    const tag = (cursor.tagName || '').toUpperCase();
    if (/^H[1-4]$/.test(tag)) break;

    if (tag === 'UL' || tag === 'OL') {
      const items = cursor.querySelectorAll ? Array.from(cursor.querySelectorAll('li')) : [];
      for (const li of items) {
        const text = decodeHtmlText(li.textContent || '').trim();
        if (text.length > 1) results.push(text);
      }
      if (results.length > 0) return results;
    } else if (tag === 'DIV' && cursor.querySelectorAll) {
      const items = Array.from(cursor.querySelectorAll('li'));
      if (items.length > 0) {
        for (const li of items) {
          const text = decodeHtmlText(li.textContent || '').trim();
          if (text.length > 1) results.push(text);
        }
        return results;
      }
    } else if (tag === 'P') {
      const text = decodeHtmlText(cursor.textContent || '').trim();
      if (text.length > 8) results.push(text);
    }

    cursor = (cursor.nextElementSibling as typeof cursor) || null;
    hops += 1;
  }

  return results;
}

// ============================================================================
// Formatting & Entity Decoding Utilities
// ============================================================================

/**
 * Extracts a clean recipe title from `<h1>` or `<title>`.
 */
function extractPageTitle(document: ReturnType<typeof parseHTML>['document']): string {
  const h1 = decodeHtmlText(document.querySelector('h1')?.textContent || '');
  if (h1 && h1.length < 120) return h1;
  const titleTag = decodeHtmlText(document.querySelector('title')?.textContent || '');
  return titleTag.split(/\s+[|\-–—]\s+/)[0]?.trim() || 'Extracted Recipe Spec';
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
