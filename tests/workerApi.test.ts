/**
 * ============================================================================
 * Integration Tests — HTML Scraper, Workers AI Fallback & 14-Day Share API
 * ============================================================================
 */

import { afterEach, describe, expect, it, vi } from './testHarness';
import type { KVNamespaceBinding, TrnRecipeDocument, WorkerEnv } from '../src/shared/types';
import { APP_VERSION, SHARE_TTL_SECONDS } from '../src/shared/version';
import { app } from '../src/worker/index';
import {
  extractRecipeFromHtml,
  fetchAndExtractRecipe,
  validatePublicRecipeUrl,
} from '../src/worker/scraper';

describe('HTML Scraper (JSON-LD & Microdata)', () => {
  it('extracts recipe fields from schema.org/Recipe inside @graph JSON-LD', () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@graph": [
                { "@type": "WebSite", "name": "Cooking Blog" },
                {
                  "@type": ["Recipe"],
                  "name": "Garlic Toast",
                  "prepTime": "PT5M",
                  "cookTime": "PT10M",
                  "recipeYield": "4 slices",
                  "recipeIngredient": ["4 slices sourdough bread", "2 tbsp butter", "1 clove garlic"],
                  "recipeInstructions": [
                    { "@type": "HowToStep", "text": "Mix softened butter and minced garlic." },
                    { "@type": "HowToStep", "text": "Spread on sourdough bread and broil at 450°F for 4 minutes." }
                  ]
                }
              ]
            }
          </script>
        </head>
        <body><h1>Life story bloat ignored</h1></body>
      </html>
    `;

    const extracted = extractRecipeFromHtml(html, 'https://example.com/toast');
    expect(extracted.extractionMethod).toBe('json-ld');
    expect(extracted.title).toBe('Garlic Toast');
    expect(extracted.prepTime).toBe('5 min');
    expect(extracted.cookTime).toBe('10 min');
    expect(extracted.rawIngredients).toHaveLength(3);
    expect(extracted.rawInstructions).toHaveLength(2);
  });
});

describe('Worker Hono API (/api/health, /api/parse, /api/share)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('GET /api/health reports synced version and 1,209,600s retention TTL', async () => {
    const res = await app.fetch(new Request('http://localhost/api/health'), {});
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      version: string;
      shareTtlSeconds: number;
    };
    expect(json.ok).toBe(true);
    expect(json.version).toBe(APP_VERSION);
    expect(json.shareTtlSeconds).toBe(1209600);
  });

  it('POST /api/parse compiles raw text and triggers Workers AI fallback when confidence is low', async () => {
    const aiMock = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          title: 'AI Refined Omelette',
          steps: [
            'Whisk eggs and salt in a mixing bowl.',
            'Melt butter in a skillet and cook eggs 3 minutes.',
          ],
          ingredients: [
            { line: '3 large eggs', stepIndex: 0 },
            { line: '1/4 tsp salt', stepIndex: 0 },
            { line: '1 tbsp butter', stepIndex: 1 },
          ],
        }),
      }),
    };

    const env: WorkerEnv = { AI: aiMock };
    const req = new Request('http://localhost/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawText: 'Omelette\nMake an omelette with eggs and butter.',
        preferAi: true,
      }),
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      document: {
        title: string;
        metadata: { parserEngine: string };
        ingredients: unknown[];
      };
    };

    expect(aiMock.run).toHaveBeenCalledTimes(1);
    expect(json.ok).toBe(true);
    expect(json.document.title).toBe('AI Refined Omelette');
    expect(json.document.ingredients).toHaveLength(3);
  });

  it('POST /api/share saves to RECIPE_KV with exact 14-day TTL and rejects expired links after 2 weeks', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2026-11-18T12:00:00Z');
    vi.setSystemTime(baseTime);

    const kvBacking = new Map<string, string>();
    const putSpy = vi.fn(
      async (key: string, value: string, _opts?: { expirationTtl?: number }) => {
        kvBacking.set(key, value);
      }
    );
    const kvMock: KVNamespaceBinding = {
      get: async (key: string) => kvBacking.get(key) ?? null,
      put: putSpy,
      delete: async (key: string) => {
        kvBacking.delete(key);
      },
    };
    const env: WorkerEnv = {
      RECIPE_KV: kvMock,
      SHARE_SIGNING_KEY: 'test-integration-hmac-key-0123456789',
    };

    // Compile a sample recipe first
    const parseRes = await app.fetch(
      new Request('http://localhost/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText:
            'Simple Toast\nIngredients:\n- 2 slices bread\nInstructions:\n1. Toast bread.',
        }),
      }),
      env
    );
    const parsed = (await parseRes.json()) as { document: unknown };

    // Save shareable link
    const shareRes = await app.fetch(
      new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: parsed.document }),
      }),
      env
    );
    expect(shareRes.status).toBe(201);
    const shareJson = (await shareRes.json()) as {
      ok: boolean;
      id: string;
      token: string;
      ttlSeconds: number;
      storageMode: string;
    };

    expect(shareJson.ok).toBe(true);
    expect(shareJson.ttlSeconds).toBe(SHARE_TTL_SECONDS);
    expect(shareJson.storageMode).toBe('kv');
    expect(putSpy).toHaveBeenCalledWith(
      `trn:${shareJson.id}`,
      expect.any(String),
      { expirationTtl: 1209600 }
    );

    // Valid read at Day 13
    vi.setSystemTime(new Date(baseTime.getTime() + 13 * 24 * 60 * 60 * 1000));
    const loadValidRes = await app.fetch(
      new Request(`http://localhost/api/share/${shareJson.id}`),
      env
    );
    expect(loadValidRes.status).toBe(200);

    // Tampered signed token is rejected
    const flipChar = shareJson.token.endsWith('A') ? 'B' : 'A';
    const tamperedToken = `${shareJson.token.slice(0, -1)}${flipChar}`;
    const tamperedRes = await app.fetch(
      new Request(`http://localhost/api/share/${encodeURIComponent(tamperedToken)}`),
      env
    );
    expect(tamperedRes.status).toBe(404);

    // Expired after 14 days + 1 second -> 410 Gone
    vi.setSystemTime(new Date(baseTime.getTime() + (SHARE_TTL_SECONDS + 1) * 1000));
    const expiredKvRes = await app.fetch(
      new Request(`http://localhost/api/share/${shareJson.id}`),
      env
    );
    expect(expiredKvRes.status).toBe(410);
    const expiredBody = (await expiredKvRes.json()) as { expired: boolean };
    expect(expiredBody.expired).toBe(true);

    // Signed token also rejects after 14 days
    const expiredTokenRes = await app.fetch(
      new Request(`http://localhost/api/share/${encodeURIComponent(shareJson.token)}`),
      env
    );
    expect(expiredTokenRes.status).toBe(410);
  });
});

describe('Security Controls (SSRF, URI Sanitization, Payload Bounds, Headers)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('blocks private, loopback, CGNAT, credentialed, and IPv6 redirect SSRF targets', async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
      });
    }) as typeof fetch;

    await expect(
      fetchAndExtractRecipe('https://example.com/recipes/pie')
    ).rejects.toThrow(/Local or private network URLs cannot be fetched/);
    expect(fetchCalls).toBe(1);

    await expect(
      Promise.resolve().then(() => validatePublicRecipeUrl('http://100.64.0.1/admin'))
    ).rejects.toThrow(/Local or private network URLs/);
    await expect(
      Promise.resolve().then(() => validatePublicRecipeUrl('http://[::ffff:127.0.0.1]/'))
    ).rejects.toThrow(/Local or private network URLs/);
    await expect(
      Promise.resolve().then(() => validatePublicRecipeUrl('https://user:pass@example.com/recipe'))
    ).rejects.toThrow(/embedded credentials/);
  });

  it('strips javascript: sourceUrl payloads during /api/share persistence and retrieval', async () => {
    const parseRes = await app.fetch(
      new Request('http://localhost/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: 'Tea\nIngredients:\n- 1 cup water\nInstructions:\n1. Boil water.',
        }),
      }),
      {}
    );
    const parsed = (await parseRes.json()) as { document: TrnRecipeDocument };
    parsed.document.metadata.sourceUrl = 'javascript:alert(document.domain)';

    const shareRes = await app.fetch(
      new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: parsed.document }),
      }),
      {}
    );
    expect(shareRes.status).toBe(201);
    const shareJson = (await shareRes.json()) as { id: string };

    const loadRes = await app.fetch(
      new Request(`http://localhost/api/share/${shareJson.id}`),
      {}
    );
    expect(loadRes.status).toBe(200);
    const loaded = (await loadRes.json()) as { document: TrnRecipeDocument };
    expect(loaded.document.metadata.sourceUrl).toBe(undefined);
  });

  it('sets defensive security headers and enforces /api/parse & /api/share size limits', async () => {
    const healthRes = await app.fetch(new Request('http://localhost/api/health'), {});
    expect(healthRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(healthRes.headers.get('X-Frame-Options')).toBe('DENY');
    expect(healthRes.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');

    const oversizedRawRes = await app.fetch(
      new Request('http://localhost/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: 'x'.repeat(100_005) }),
      }),
      {}
    );
    expect(oversizedRawRes.status).toBe(413);

    const oversizedShareRes = await app.fetch(
      new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: {
            title: 'Too Big',
            ingredients: Array.from({ length: 201 }, (_v, i) => ({
              id: `i-${i}`,
              quantity: 1,
              rawQuantity: '1',
              unit: 'g',
              name: 'salt',
              prepNote: '',
              firstUsedStepIndex: 0,
            })),
            actions: [],
          },
        }),
      }),
      {}
    );
    expect(oversizedShareRes.status).toBe(413);
  });

  it('always issues compact /r/<id> short URLs even without RECIPE_KV bound', async () => {
    const parseRes = await app.fetch(
      new Request('http://localhost/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: 'Oatmeal\nIngredients:\n- 1 cup oats\nInstructions:\n1. Simmer oats in water.',
        }),
      }),
      {}
    );
    const parsed = (await parseRes.json()) as { document: TrnRecipeDocument };

    const shareRes = await app.fetch(
      new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: parsed.document }),
      }),
      {}
    );
    expect(shareRes.status).toBe(201);
    const shareJson = (await shareRes.json()) as {
      id: string;
      sharePath: string;
      storageMode: string;
    };
    expect(shareJson.sharePath).toBe(`/r/${shareJson.id}`);
    expect(shareJson.id).toHaveLength(8);
    expect(shareJson.storageMode).toBe('edge-cache');
  });
});
