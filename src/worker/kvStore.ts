/**
 * ============================================================================
 * 2-Week Ephemeral Share Storage (Cloudflare KV + HMAC-Signed Token Fallback)
 * ----------------------------------------------------------------------------
 * Persists user-edited TRN recipe specifications with a strict 14-day
 * (1,209,600-second) retention limit:
 *   - When `RECIPE_KV` is bound in the Cloudflare Dashboard, writes to KV with
 *     native `{ expirationTtl: 1209600 }` and issues a clean short ID (`/r/:id`).
 *   - Even before KV is bound (zero-CLI first deploy), issues a cryptographically
 *     signed HMAC-SHA256 payload token (`?r=tok.<payload>.<sig>`) and checks
 *     embedded `expiresAtMs` on every read to enforce the 14-day TTL strictly.
 * ============================================================================
 */

import type { TrnRecipeDocument, WorkerEnv } from '../shared/types';
import { SHARE_TTL_MS, SHARE_TTL_SECONDS } from '../shared/version';

// ============================================================================
// Internal Envelope & Storage State
// ============================================================================

/** Serialized wrapper stored in KV, edge memory, or signed tokens. */
interface StoredRecipeEnvelope {
  document: TrnRecipeDocument;
  issuedAtMs: number;
  expiresAtMs: number;
  expiresAt: string;
}

/** Maximum in-memory entries retained per isolate when KV is not bound. */
const MAX_MEMORY_ENTRIES = 250;

/** Isolate-local fallback map keyed by short ID. */
const memoryStore = new Map<string, StoredRecipeEnvelope>();

/** Isolate-local fallback CSPRNG HMAC secret when `SHARE_SIGNING_KEY` is unset. */
let ephemeralSecretBytes: Uint8Array | null = null;

// ============================================================================
// Cryptographic Helpers (Web Crypto HMAC-SHA256)
// ============================================================================

/**
 * Resolves the HMAC-SHA256 signing key from `env.SHARE_SIGNING_KEY` or an
 * isolate-scoped CSPRNG secret generated via `crypto.getRandomValues`.
 */
async function getHmacKey(env?: WorkerEnv): Promise<CryptoKey> {
  let keyBytes: Uint8Array;

  if (env?.SHARE_SIGNING_KEY && env.SHARE_SIGNING_KEY.trim().length > 0) {
    keyBytes = new TextEncoder().encode(env.SHARE_SIGNING_KEY.trim());
  } else {
    if (!ephemeralSecretBytes) {
      ephemeralSecretBytes = crypto.getRandomValues(new Uint8Array(32));
    }
    keyBytes = ephemeralSecretBytes;
  }

  return crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Encodes bytes into URL-safe Base64 without padding.
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Decodes canonical URL-safe Base64 into a Uint8Array, rejecting non-canonical
 * trailing padding bits to prevent malleable token encodings.
 */
function fromBase64Url(encoded: string): Uint8Array {
  const padded =
    encoded.replace(/-/g, '+').replace(/_/g, '/') +
    '==='.slice((encoded.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (toBase64Url(bytes) !== encoded) {
    throw new Error('Non-canonical base64url token encoding.');
  }
  return bytes;
}

/**
 * Generates an 8-character URL-safe short ID using Web Crypto randomness.
 */
function generateShortId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const rand = crypto.getRandomValues(new Uint8Array(8));
  let id = '';
  for (let i = 0; i < rand.length; i += 1) {
    id += alphabet[rand[i] % alphabet.length];
  }
  return id;
}

/**
 * Strips any non-HTTP(S) `sourceUrl` (such as `javascript:` or `data:`) from
 * a document's metadata to guard against stored XSS links.
 */
export function sanitizeDocumentSourceUrl(doc: TrnRecipeDocument): TrnRecipeDocument {
  const rawSource = doc.metadata?.sourceUrl;
  if (!rawSource) return doc;

  let safeUrl: string | undefined;
  try {
    const parsed = new URL(rawSource.trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      safeUrl = parsed.toString();
    }
  } catch {
    safeUrl = undefined;
  }

  return {
    ...doc,
    metadata: {
      ...doc.metadata,
      sourceUrl: safeUrl,
    },
  };
}

// ============================================================================
// Public Save & Load API (Enforces 14-Day TTL)
// ============================================================================

/**
 * Saves a TRN recipe specification for exactly 2 weeks (14 days / 1,209,600s).
 *
 * @param doc - Compiled and optionally user-edited TrnRecipeDocument.
 * @param env - Optional Cloudflare Worker environment containing `RECIPE_KV`.
 * @returns Share metadata including short ID, signed token, and expiration ISO timestamp.
 */
export async function saveSharedRecipe(
  doc: TrnRecipeDocument,
  env?: WorkerEnv
): Promise<{
  id: string;
  token: string;
  sharePath: string;
  expiresAt: string;
  ttlSeconds: number;
  storageMode: 'kv' | 'signed-token';
}> {
  const nowMs = Date.now();
  const expiresAtMs = nowMs + SHARE_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const id = generateShortId();

  const cleanDoc = sanitizeDocumentSourceUrl(doc);
  const docWithExpiry: TrnRecipeDocument = {
    ...cleanDoc,
    metadata: {
      ...cleanDoc.metadata,
      expiresAt,
    },
  };

  const envelope: StoredRecipeEnvelope = {
    document: docWithExpiry,
    issuedAtMs: nowMs,
    expiresAtMs,
    expiresAt,
  };

  const serialized = JSON.stringify(envelope);

  // Persist to Cloudflare KV with native 14-day expirationTtl when bound
  let usedKv = false;
  if (env?.RECIPE_KV) {
    await env.RECIPE_KV.put(`trn:${id}`, serialized, {
      expirationTtl: SHARE_TTL_SECONDS,
    });
    usedKv = true;
  }

  // Also cache in bounded isolate memory for immediate readback
  if (memoryStore.size >= MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryStore.keys().next().value;
    if (oldestKey) memoryStore.delete(oldestKey);
  }
  memoryStore.set(id, envelope);

  // Produce a signed portable token verifying integrity + 14-day expiry
  const payloadBytes = new TextEncoder().encode(serialized);
  const payloadB64 = toBase64Url(payloadBytes);
  const hmacKey = await getHmacKey(env);
  const sigBuffer = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    new TextEncoder().encode(payloadB64)
  );
  const sigB64 = toBase64Url(new Uint8Array(sigBuffer));
  const token = `tok.${payloadB64}.${sigB64}`;

  return {
    id,
    token,
    sharePath: usedKv ? `/r/${id}` : `?r=${token}`,
    expiresAt,
    ttlSeconds: SHARE_TTL_SECONDS,
    storageMode: usedKv ? 'kv' : 'signed-token',
  };
}

/**
 * Loads a previously shared TRN document by short ID or signed token, strictly
 * rejecting any link older than 2 weeks (14 days).
 *
 * @param idOrToken - Short ID (e.g., "a8k2p9qx") or `tok.<payload>.<sig>`.
 * @param env - Optional Cloudflare Worker bindings.
 * @returns Document if valid and unexpired, or `expired: true` if past 14 days.
 */
export async function loadSharedRecipe(
  idOrToken: string,
  env?: WorkerEnv
): Promise<{
  document: TrnRecipeDocument | null;
  expired: boolean;
  expiresAt?: string;
  invalid?: boolean;
}> {
  const trimmed = idOrToken.trim();
  if (!trimmed) {
    return { document: null, expired: false, invalid: true };
  }

  // Case 1: Self-contained HMAC-SHA256 signed token (`tok.<payload>.<sig>`)
  if (trimmed.startsWith('tok.')) {
    const parts = trimmed.split('.');
    if (parts.length !== 3) {
      return { document: null, expired: false, invalid: true };
    }
    const [, payloadB64, sigB64] = parts;
    try {
      const hmacKey = await getHmacKey(env);
      const sigBytes = fromBase64Url(sigB64);
      const isValid = await crypto.subtle.verify(
        'HMAC',
        hmacKey,
        sigBytes.buffer as ArrayBuffer,
        new TextEncoder().encode(payloadB64)
      );
      if (!isValid) {
        return { document: null, expired: false, invalid: true };
      }

      const jsonText = new TextDecoder().decode(fromBase64Url(payloadB64));
      const envelope = JSON.parse(jsonText) as StoredRecipeEnvelope;
      if (Date.now() > envelope.expiresAtMs) {
        return {
          document: null,
          expired: true,
          expiresAt: envelope.expiresAt,
        };
      }

      return {
        document: sanitizeDocumentSourceUrl(envelope.document),
        expired: false,
        expiresAt: envelope.expiresAt,
      };
    } catch {
      return { document: null, expired: false, invalid: true };
    }
  }

  // Case 2: Short ID lookup in Cloudflare KV or isolate memory
  let rawJson: string | null = null;
  if (env?.RECIPE_KV) {
    rawJson = await env.RECIPE_KV.get(`trn:${trimmed}`);
  }

  let envelope: StoredRecipeEnvelope | null = null;
  if (rawJson) {
    try {
      envelope = JSON.parse(rawJson) as StoredRecipeEnvelope;
    } catch {
      envelope = null;
    }
  } else {
    envelope = memoryStore.get(trimmed) || null;
  }

  if (!envelope) {
    return { document: null, expired: false };
  }

  // Enforce strict 14-day timestamp validation even before background KV sweep
  if (Date.now() > envelope.expiresAtMs) {
    memoryStore.delete(trimmed);
    if (env?.RECIPE_KV) {
      await env.RECIPE_KV.delete(`trn:${trimmed}`);
    }
    return {
      document: null,
      expired: true,
      expiresAt: envelope.expiresAt,
    };
  }

  return {
    document: sanitizeDocumentSourceUrl(envelope.document),
    expired: false,
    expiresAt: envelope.expiresAt,
  };
}
