/**
 * ============================================================================
 * Shared TypeScript Contracts (Worker + Client)
 * ----------------------------------------------------------------------------
 * Defines the canonical Tabular Recipe Notation (TRN) data structures,
 * API request/response schemas, Cloudflare binding interfaces, and global
 * `window.api` augmentation.
 * ============================================================================
 */

// ============================================================================
// Display & Conversion Modes
// ============================================================================

/** Supported culinary measurement display systems in the client UI. */
export type UnitSystem = 'original' | 'metric' | 'imperial';

/** Available table presentation formats toggled by the user. */
export type TrnViewMode = 'nested' | 'summary';

/** Parser strategy recorded in the document's engineering metadata block. */
export type ParserEngine = 'heuristic' | 'workers-ai' | 'hybrid';

// ============================================================================
// Core TRN Graph & Document Structures
// ============================================================================

/**
 * Represents a single row in the left-hand ingredient stack of a TRN sheet.
 * Divided ingredients (e.g., "1 cup sugar, divided") are automatically split
 * into multiple IngredientRow records pinned to their respective step indices
 * so downstream merged action cells remain 100% contiguous.
 */
export interface IngredientRow {
  /** Stable unique identifier for this ingredient row. */
  id: string;
  /** Numeric quantity for the primary amount (null for "to taste", "pinch", etc.). */
  quantity: number | null;
  /** Optional upper-bound numeric quantity when an ingredient specifies a range (e.g. 2-3). */
  quantityMax?: number | null;
  /** Original raw quantity token text prior to scaling/conversion. */
  rawQuantity: string;
  /** Normalized or original unit string (e.g., "cup", "tbsp", "g", "large", ""). */
  unit: string;
  /** Canonical ingredient name (e.g., "all-purpose flour", "unsalted butter"). */
  name: string;
  /** Preparation or state modifier (e.g., "finely diced", "softened", "sifted"). */
  prepNote: string;
  /** True when this row was auto-created by splitting a "divided" ingredient. */
  isDividedSplit?: boolean;
  /** Sub-assembly label for split parts (e.g., "Part 1/2 - Step 2"). */
  dividedPartLabel?: string;
  /** Zero-based index of the earliest cooking step that consumes this row. */
  firstUsedStepIndex: number;
  /** Interactive Kitchen Bench Mode checkoff flag. */
  completed?: boolean;
}

/**
 * Represents an operational assembly block in the TRN dependency matrix.
 * In the classic "Cooking for Engineers" layout, an action node spans a
 * contiguous vertical slice of rows [startRow..endRow] at a given columnDepth.
 */
export interface TrnActionNode {
  /** Stable unique identifier for this operation node. */
  id: string;
  /** 1-based step index matching the recipe sequence. */
  stepNumber: number;
  /** Horizontal topological layer depth (0 = initial ingredient merge, higher = downstream). */
  columnDepth: number;
  /** Inclusive 0-based start row index in `ingredients`. */
  startRow: number;
  /** Inclusive 0-based end row index in `ingredients`. */
  endRow: number;
  /** IDs of base IngredientRows directly introduced in this step. */
  ingredientRowIds: string[];
  /** IDs of upstream TrnActionNodes merged into this step. */
  inputNodeIds: string[];
  /** Lead engineering action verb (e.g., "WHISK", "FOLD", "SEAR", "BAKE"). */
  verb: string;
  /** Concise, de-fluffed imperative instruction text for the cell. */
  instruction: string;
  /** Extracted timing parameter if present (e.g., "10-12 min"). */
  duration?: string;
  /** Extracted temperature parameter if present (e.g., "350°F"). */
  temperature?: string;
  /** Extracted cookware/hardware tags required for this operation. */
  hardware?: string[];
  /** Human-readable name of the intermediate or final mixture produced. */
  outputLabel: string;
  /** Interactive Kitchen Bench Mode checkoff flag. */
  completed?: boolean;
}

/**
 * Represents a single row in the alternate Row-per-Step Engineering Summary Table.
 */
export interface TrnStepSummaryRow {
  /** Unique ID matching or derived from the corresponding TrnActionNode. */
  id: string;
  /** 1-based step number. */
  stepNumber: number;
  /** Ingredient IDs directly used in this step (live-synced with unit conversions). */
  ingredientIds: string[];
  /** Preformatted fallback summary text for ingredients when customized inline. */
  ingredientsSummary: string;
  /** Action description text for the step. */
  actionText: string;
  /** Consolidated parameters string (hardware, target temp, duration). */
  parametersText: string;
  /** Resulting intermediate sub-assembly or final dish label. */
  outputLabel: string;
  /** Interactive Kitchen Bench Mode checkoff flag. */
  completed?: boolean;
}

/**
 * Engineering specification title-block metadata displayed above the TRN matrix
 * and rendered onto exported PDF spec sheets.
 */
export interface RecipeSpecMetadata {
  /** Deterministic document identifier (e.g., "DOC-TRN-A4B9"). */
  docNumber: string;
  /** Revision stamp (e.g., "REV 1.0"). */
  revision: string;
  /** Original source URL if parsed from the web. */
  sourceUrl?: string;
  /** Extracted preparation duration (e.g., "15 min"). */
  prepTime?: string;
  /** Extracted active/cook duration (e.g., "25 min"). */
  cookTime?: string;
  /** Extracted total duration (e.g., "40 min"). */
  totalTime?: string;
  /** Numeric base servings/yield used for batch scaling. */
  baseServings: number;
  /** Original yield description (e.g., "24 cookies", "4 servings"). */
  yieldLabel: string;
  /** Consolidated cookware & equipment list for mise en place. */
  hardware: string[];
  /** Critical target temperatures (oven preheat, internal temp, oil temp). */
  criticalTemperatures: string[];
  /** Engine used to compile the TRN graph. */
  parserEngine: ParserEngine;
  /** Confidence score from 0.0 to 1.0 assigned by the parser. */
  confidenceScore: number;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 expiration timestamp for shared links (createdAt + 14 days). */
  expiresAt?: string;
}

/**
 * Complete compiled Tabular Recipe Notation document.
 */
export interface TrnRecipeDocument {
  /** Document UUID or slug identifier. */
  id: string;
  /** De-fluffed recipe title. */
  title: string;
  /** Short technical summary or subtitle. */
  description?: string;
  /** Engineering title-block metadata. */
  metadata: RecipeSpecMetadata;
  /** Ordered list of ingredient rows forming the left columns of the TRN grid. */
  ingredients: IngredientRow[];
  /** Topological action nodes forming the merged right columns of the TRN grid. */
  actions: TrnActionNode[];
  /** Row-per-step projection for the Summary Table view. */
  summaryRows: TrnStepSummaryRow[];
}

// ============================================================================
// Scraper & API Payloads
// ============================================================================

/** Intermediate raw recipe structure extracted prior to TRN graph compilation. */
export interface ExtractedRawRecipe {
  title: string;
  description?: string;
  sourceUrl?: string;
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  servings: number;
  yieldLabel: string;
  rawIngredients: string[];
  rawInstructions: string[];
  /** Clean newline-delimited excerpt of article/recipe body for Workers AI fallback. */
  rawBodyExcerpt?: string;
  extractionMethod: 'json-ld' | 'microdata' | 'html-heuristic' | 'raw-text';
}

/** POST /api/parse request payload. */
export interface ParseRecipeRequest {
  url?: string;
  rawText?: string;
  preferAi?: boolean;
}

/** POST /api/parse response payload. */
export interface ParseRecipeResponse {
  ok: boolean;
  document?: TrnRecipeDocument;
  warnings?: string[];
  error?: string;
}

/** POST /api/share request payload. */
export interface ShareRecipeRequest {
  document: TrnRecipeDocument;
}

/** POST /api/share response payload. */
export interface ShareRecipeResponse {
  ok: boolean;
  id?: string;
  token?: string;
  sharePath?: string;
  expiresAt?: string;
  ttlSeconds?: number;
  storageMode?: 'kv' | 'edge-cache';
  error?: string;
}

/** GET /api/share/:id response payload. */
export interface LoadSharedRecipeResponse {
  ok: boolean;
  document?: TrnRecipeDocument;
  expired?: boolean;
  expiresAt?: string;
  error?: string;
}

// ============================================================================
// Cloudflare Worker Runtime Bindings (Zero-Global-Collision Structural Types)
// ============================================================================

/** Minimal structural type for Cloudflare KVNamespace binding (`RECIPE_KV`). */
export interface KVNamespaceBinding {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; expiration?: number }
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Minimal structural type for Cloudflare Workers AI binding (`AI`). */
export interface WorkersAiBinding {
  run(
    model: string,
    input: {
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      max_tokens?: number;
      temperature?: number;
    }
  ): Promise<{ response?: string } | unknown>;
}

/** Minimal structural type for Cloudflare Static Assets binding (`ASSETS`). */
export interface StaticAssetsBinding {
  fetch(request: Request): Promise<Response>;
}

/** Cloudflare Worker environment bindings accepted by the Hono backend. */
export interface WorkerEnv {
  ASSETS?: StaticAssetsBinding;
  AI?: WorkersAiBinding;
  RECIPE_KV?: KVNamespaceBinding;
  SHARE_SIGNING_KEY?: string;
}

/** Minimal Cloudflare ExecutionContext structural type. */
export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  props?: Record<string, unknown>;
}

// ============================================================================
// Global Window API Augmentation (Dynamic Version Sync)
// ============================================================================

declare global {
  interface Window {
    api: {
      appVersion: string;
    };
  }
}
