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
  clearScraperCacheForTests,
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

  it('extracts multi-component Substack blog recipes while ignoring essay preamble and comments', () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>A Pumpkin Pie Even I Can Love - by Sohla El-Waylly</title>
          <script type="application/ld+json">
            { "@context": "https://schema.org", "@type": "NewsArticle", "headline": "A Pumpkin Pie Even I Can Love" }
          </script>
        </head>
        <body>
          <h1 class="pub-headings">Hot Dish with Sohla</h1>
          <article class="post">
            <h1 class="post-title">A Pumpkin Pie Even I Can Love</h1>
            <div class="body markup">
              <p>Long story about why I usually skip pumpkin pie at Thanksgiving.</p>
              <div class="subscribe-widget"><button>Subscribe</button></div>
              <h1>A Very Good &amp; Very Easy Pumpkin Pie Recipe</h1>
              <p>Gingersnap crust and salty cream cheese whip.</p>
              <div><hr></div>
              <h5>For the crust:</h5>
              <ul>
                <li><p>170g ginger snaps (about 1 1/2 c crumbs)</p></li>
                <li><p>25g (2 tbsp) granulated sugar</p></li>
                <li><p>1/2 tsp fine salt</p></li>
                <li><p>56g (4 tbsp) unsalted butter, melted</p></li>
              </ul>
              <h5>For the filling:</h5>
              <ul>
                <li><p>1 (15-oz) can pumpkin puree</p></li>
                <li><p>1/2 tsp fine salt</p></li>
                <li><p>4 tbsp unsalted butter</p></li>
                <li><p>1 1/2 tbsp pumpkin pie spice</p></li>
              </ul>
              <h5>For the topping:</h5>
              <ul>
                <li><p>6 oz softened cream cheese</p></li>
                <li><p>2 tbsp granulated sugar</p></li>
                <li><p>1/4 to 1/2 tsp fine salt (Taste it!)</p></li>
                <li><p>1 1/2 c heavy whipping cream</p></li>
              </ul>
              <div><hr></div>
              <p><strong>Make the crust:</strong> Heat the oven to 325F. Process gingersnaps, sugar, and salt, then drizzle in melted butter.</p>
              <p>(Alternatively, smash in a bag with a rolling pin.)</p>
              <p>Bake until lightly browned, about 20 minutes.</p>
              <p><strong>Make the filling:</strong> Whisk pumpkin puree and salt in a bowl.</p>
              <p>Melt butter in a small saucepan and add the spices for 30 seconds. Scrape into filling.</p>
              <p><strong>For the cream:</strong> Stir cream cheese, sugar, and 1/4 teaspoon salt, then add remaining cream and whip.</p>
              <p class="button-wrapper"><a href="#comments">Leave a comment</a></p>
            </div>
          </article>
          <div class="comments-page"><h4>Discussion about this post</h4><p>Great recipe!</p></div>
        </body>
      </html>
    `;

    const extracted = extractRecipeFromHtml(
      html,
      'https://sohla.substack.com/p/a-pumpkin-pie-even-i-can-love'
    );
    expect(extracted.extractionMethod).toBe('html-heuristic');
    expect(extracted.title).toBe('A Very Good & Very Easy Pumpkin Pie Recipe');
    expect(extracted.description).toContain('Gingersnap crust');
    expect(extracted.rawIngredients).toHaveLength(12);
    expect(extracted.rawInstructions).toHaveLength(5);
    expect(extracted.rawInstructions[0]).toContain('(Alternatively, smash in a bag');
    expect(extracted.rawInstructions.join(' ')).not.toContain('Leave a comment');
    expect(extracted.rawInstructions.join(' ')).not.toContain('Great recipe');
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

  it('accepts pre-parsed Workers AI object payloads with step verbs/outputLabels and warns when preferAi lacks AI binding', async () => {
    const objectAiMock = {
      run: vi.fn().mockResolvedValue({
        response: {
          title: 'Workers AI Pumpkin Pie',
          steps: [
            {
              instruction: 'Process gingersnaps, sugar, salt, and melted butter into crust crumbs.',
              verb: 'PROCESS',
              outputLabel: 'Crust Crumbs',
            },
            {
              instruction: 'Bake crust at 325F for 20 minutes.',
              verb: 'BAKE',
              outputLabel: 'FINISHED DISH',
            },
          ],
          ingredients: [
            { line: '170g ginger snaps', stepIndex: 0 },
            { line: '56g unsalted butter, melted', stepIndex: 0 },
          ],
        },
      }),
    };

    const resWithAi = await app.fetch(
      new Request('http://localhost/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: 'Pie\nIngredients:\n- 170g ginger snaps\nInstructions:\n1. Bake crust.',
          preferAi: true,
        }),
      }),
      { AI: objectAiMock }
    );
    expect(resWithAi.status).toBe(200);
    const aiPayload = (await resWithAi.json()) as {
      ok: boolean;
      document: TrnRecipeDocument;
    };
    expect(aiPayload.ok).toBe(true);
    expect(aiPayload.document.title).toBe('Workers AI Pumpkin Pie');
    expect(aiPayload.document.metadata.parserEngine).toBe('workers-ai');
    expect(aiPayload.document.actions[0].verb).toBe('PROCESS');
    expect(aiPayload.document.actions[0].outputLabel).toBe('Crust Crumbs');

    // Request with preferAi=true when AI binding is absent should surface a clear warning
    const resNoAi = await app.fetch(
      new Request('http://localhost/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: 'Toast\nIngredients:\n- 2 slices bread\nInstructions:\n1. Toast bread.',
          preferAi: true,
        }),
      }),
      {}
    );
    expect(resNoAi.status).toBe(200);
    const noAiPayload = (await resNoAi.json()) as {
      ok: boolean;
      warnings?: string[];
    };
    expect(noAiPayload.ok).toBe(true);
    expect(noAiPayload.warnings?.[0]).toContain('Workers AI binding (AI) is not attached');
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
    clearScraperCacheForTests();
  });

  it('recovers from HTTP 429 on Substack post pages via /api/v1/posts/<slug> and caches the result', async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      requestedUrls.push(target);

      if (target === 'https://sohla.substack.com/p/a-pumpkin-pie-even-i-can-love') {
        return new Response('Too Many Requests', { status: 429 });
      }
      if (target === 'https://sohla.substack.com/api/v1/posts/a-pumpkin-pie-even-i-can-love') {
        return new Response(
          JSON.stringify({
            title: 'A Pumpkin Pie Even I Can Love',
            subtitle: 'Salty cream cheese whip',
            body_html: `
              <h1>A Very Good &amp; Very Easy Pumpkin Pie Recipe</h1>
              <h5>For the crust:</h5>
              <ul>
                <li><p>170g ginger snaps</p></li>
                <li><p>56g unsalted butter, melted</p></li>
              </ul>
              <p><strong>Make the crust:</strong> Process gingersnaps and melted butter, then bake at 325F for 20 minutes.</p>
            `,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const first = await fetchAndExtractRecipe(
      'https://sohla.substack.com/p/a-pumpkin-pie-even-i-can-love'
    );
    expect(first.title).toBe('A Very Good & Very Easy Pumpkin Pie Recipe');
    expect(first.rawIngredients).toHaveLength(2);
    expect(first.rawInstructions).toHaveLength(1);
    expect(requestedUrls).toEqual([
      'https://sohla.substack.com/p/a-pumpkin-pie-even-i-can-love',
      'https://sohla.substack.com/api/v1/posts/a-pumpkin-pie-even-i-can-love',
    ]);

    // Second fetch uses TTL cache without making additional network requests
    const second = await fetchAndExtractRecipe(
      'https://sohla.substack.com/p/a-pumpkin-pie-even-i-can-love'
    );
    expect(second.title).toBe('A Very Good & Very Easy Pumpkin Pie Recipe');
    expect(requestedUrls).toHaveLength(2);
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
