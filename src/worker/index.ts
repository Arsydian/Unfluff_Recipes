/**
 * ============================================================================
 * UnfluffRecipes Cloudflare Worker Entrypoint (Hono API + Static Assets)
 * ----------------------------------------------------------------------------
 * Exposes edge REST endpoints:
 *   - GET  /api/health      : Build version, retention policy, and binding status
 *   - POST /api/parse       : Parses recipe URL or raw text into TRN JSON
 *   - POST /api/share       : Persists edited TRN sheet with strict 14-day TTL
 *   - GET  /api/share/:id   : Retrieves unexpired shared TRN sheet
 *
 * Also delegates non-API paths to Cloudflare Workers Static Assets (`env.ASSETS`).
 * ============================================================================
 */

import { Hono } from 'hono';
import type {
  ExtractedRawRecipe,
  LoadSharedRecipeResponse,
  ParseRecipeRequest,
  ParseRecipeResponse,
  ShareRecipeRequest,
  ShareRecipeResponse,
  WorkerEnv,
  WorkerExecutionContext,
} from '../shared/types';
import { APP_CODENAME, APP_VERSION, SHARE_TTL_SECONDS } from '../shared/version';
import {
  parseWithWorkersAiFallback,
  shouldTriggerAiFallback,
} from './aiFallback';
import { buildTrnDocumentHeuristic } from './heuristicParser';
import { loadSharedRecipe, saveSharedRecipe } from './kvStore';
import { extractRecipeFromRawText, fetchAndExtractRecipe } from './scraper';

// ============================================================================
// Hono Application Router & Security Limits
// ============================================================================

const MAX_URL_CHARS = 2048;
const MAX_RAW_TEXT_CHARS = 100_000;
const MAX_SHARED_INGREDIENTS = 200;
const MAX_SHARED_ACTIONS = 100;
const MAX_SHARED_BYTES = 512 * 1024;

export const app = new Hono<{ Bindings: WorkerEnv }>();

/**
 * Attaches defensive HTTP security headers on all `/api/*` responses.
 */
app.use('/api/*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

/**
 * Health & capabilities endpoint reporting synced version and optional bindings.
 */
app.get('/api/health', (c) => {
  return c.json({
    ok: true,
    version: APP_VERSION,
    codename: APP_CODENAME,
    shareTtlSeconds: SHARE_TTL_SECONDS,
    bindings: {
      ai: Boolean(c.env?.AI),
      kv: Boolean(c.env?.RECIPE_KV),
    },
  });
});

/**
 * Compiles either a recipe URL or pasted raw recipe text into a Tabular Recipe
 * Notation (TRN) document, invoking Cloudflare Workers AI if heuristic
 * confidence is low and `env.AI` is attached.
 */
app.post('/api/parse', async (c) => {
  try {
    const body = (await c.req.json()) as ParseRecipeRequest;
    const url = body.url?.trim();
    const rawText = body.rawText?.trim();

    if (!url && !rawText) {
      const response: ParseRecipeResponse = {
        ok: false,
        error: 'Provide either a recipe URL or raw recipe text.',
      };
      return c.json(response, 400);
    }

    if (url && url.length > MAX_URL_CHARS) {
      return c.json<ParseRecipeResponse>(
        { ok: false, error: 'Recipe URL exceeds maximum length (2048 chars).' },
        413
      );
    }

    if (rawText && rawText.length > MAX_RAW_TEXT_CHARS) {
      return c.json<ParseRecipeResponse>(
        { ok: false, error: 'Raw recipe text exceeds maximum size (100,000 chars).' },
        413
      );
    }

    const warnings: string[] = [];
    let rawRecipe: ExtractedRawRecipe;

    if (url) {
      rawRecipe = await fetchAndExtractRecipe(url);
    } else {
      rawRecipe = extractRecipeFromRawText(rawText || '');
    }

    // Step 1: Deterministic heuristic compilation + divided-ingredient splitting
    let trnDoc = buildTrnDocumentHeuristic(rawRecipe);

    // Step 2: Optional Workers AI fallback when confidence is low
    if (shouldTriggerAiFallback(trnDoc, body.preferAi)) {
      if (c.env?.AI) {
        trnDoc = await parseWithWorkersAiFallback(rawRecipe, trnDoc, c.env);
      } else if (trnDoc.metadata.confidenceScore < 0.55) {
        warnings.push(
          'Low heuristic confidence and Workers AI binding is not enabled; review ingredient mappings inline before PDF export.'
        );
      }
    }

    const response: ParseRecipeResponse = {
      ok: true,
      document: trnDoc,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
    return c.json(response, 200);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to parse recipe specification.';
    const response: ParseRecipeResponse = {
      ok: false,
      error: message,
    };
    return c.json(response, 422);
  }
});

/**
 * Stores a compiled (and optionally user-edited) TRN specification for 14 days.
 */
app.post('/api/share', async (c) => {
  try {
    const rawTextBody = await c.req.text();
    if (new TextEncoder().encode(rawTextBody).byteLength > MAX_SHARED_BYTES) {
      return c.json<ShareRecipeResponse>(
        { ok: false, error: 'Shared recipe payload exceeds 512 KB limit.' },
        413
      );
    }

    const body = JSON.parse(rawTextBody) as ShareRecipeRequest;
    if (
      !body?.document ||
      typeof body.document.title !== 'string' ||
      !body.document.title.trim() ||
      !Array.isArray(body.document.ingredients) ||
      !Array.isArray(body.document.actions)
    ) {
      const response: ShareRecipeResponse = {
        ok: false,
        error: 'Invalid TRN recipe document payload.',
      };
      return c.json(response, 400);
    }

    if (
      body.document.ingredients.length > MAX_SHARED_INGREDIENTS ||
      body.document.actions.length > MAX_SHARED_ACTIONS
    ) {
      return c.json<ShareRecipeResponse>(
        {
          ok: false,
          error: 'Recipe exceeds maximum share limits (200 ingredients / 100 steps).',
        },
        413
      );
    }

    const saved = await saveSharedRecipe(body.document, c.env);
    const response: ShareRecipeResponse = {
      ok: true,
      id: saved.id,
      token: saved.token,
      sharePath: saved.sharePath,
      expiresAt: saved.expiresAt,
      ttlSeconds: saved.ttlSeconds,
      storageMode: saved.storageMode,
    };
    return c.json(response, 201);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unable to generate shareable link.';
    return c.json<ShareRecipeResponse>({ ok: false, error: message }, 500);
  }
});

/**
 * Loads a shared TRN document by short ID or signed token, enforcing the
 * 2-week (14-day) retention expiration.
 */
app.get('/api/share/:id', async (c) => {
  const idOrToken = c.req.param('id');
  const result = await loadSharedRecipe(idOrToken, c.env);

  if (result.expired) {
    return c.json<LoadSharedRecipeResponse>(
      {
        ok: false,
        expired: true,
        expiresAt: result.expiresAt,
        error:
          'This shared recipe specification has expired (links are retained for 14 days).',
      },
      410
    );
  }

  if (!result.document) {
    return c.json<LoadSharedRecipeResponse>(
      {
        ok: false,
        expired: false,
        error: 'Shared recipe specification not found or invalid signature.',
      },
      404
    );
  }

  return c.json<LoadSharedRecipeResponse>(
    {
      ok: true,
      document: result.document,
      expiresAt: result.expiresAt,
    },
    200
  );
});

// ============================================================================
// Cloudflare Worker Default Export
// ============================================================================

export default {
  /**
   * Main Cloudflare Worker fetch handler routing `/api/*` to Hono and static
   * SPA traffic to Cloudflare Static Assets (`env.ASSETS`).
   */
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx?: WorkerExecutionContext
  ): Promise<Response> {
    const honoCtx = ctx
      ? {
          waitUntil: ctx.waitUntil.bind(ctx),
          passThroughOnException: ctx.passThroughOnException.bind(ctx),
          props: ctx.props ?? {},
        }
      : undefined;

    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, honoCtx);
    }
    if (env?.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return app.fetch(request, env, honoCtx);
  },
};
