/**
 * ============================================================================
 * Shared Application Version & Retention Constants
 * ----------------------------------------------------------------------------
 * Single source of truth for semantic versioning synchronized with
 * package.json, README.md, and the UI dynamic titlebar badge, alongside the
 * strict 14-day (2-week) retention window for shared recipe links.
 * ============================================================================
 */

/** Current semantic build version (must match package.json "version"). */
export const APP_VERSION = '1.0.3';

/** Engineering designation displayed in spec headers and printed footers. */
export const APP_CODENAME = 'TRN-SPEC-REV1';

/** Strict 2-week (14-day) retention period in seconds for Cloudflare KV & tokens. */
export const SHARE_TTL_SECONDS = 14 * 24 * 60 * 60; // 1,209,600 seconds

/** Strict 2-week (14-day) retention period in milliseconds. */
export const SHARE_TTL_MS = SHARE_TTL_SECONDS * 1000;
