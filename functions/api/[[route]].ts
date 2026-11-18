/**
 * ============================================================================
 * Cloudflare Pages Functions Catch-All Adapter (`/api/*`)
 * ----------------------------------------------------------------------------
 * Enables seamless zero-CLI deployment when this GitHub repository is linked
 * to Cloudflare Pages instead of Cloudflare Workers Builds, forwarding all
 * `/api/*` requests directly into the shared Hono edge router.
 * ============================================================================
 */

import type { WorkerEnv } from '../../src/shared/types';
import { app } from '../../src/worker/index';

/** Minimal Cloudflare Pages Function context contract. */
interface PagesFunctionContext {
  request: Request;
  env: WorkerEnv;
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  props?: Record<string, unknown>;
}

/**
 * Handles any HTTP method under `/api/*` in Cloudflare Pages Functions.
 *
 * @param context - Incoming Cloudflare Pages Function request context.
 * @returns Hono HTTP Response.
 */
export async function onRequest(context: PagesFunctionContext): Promise<Response> {
  return app.fetch(context.request, context.env, {
    waitUntil: context.waitUntil.bind(context),
    passThroughOnException: context.passThroughOnException.bind(context),
    props: context.props ?? {},
  });
}
