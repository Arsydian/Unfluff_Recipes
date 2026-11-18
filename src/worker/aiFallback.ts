/**
 * ============================================================================
 * Cloudflare Workers AI Fallback Parser
 * ----------------------------------------------------------------------------
 * Enhances or re-parses recipes when the deterministic heuristic parser
 * yields low confidence (e.g., unstructured blog text, narrative paragraphs,
 * or ambiguous ingredient-to-step references).
 *
 * Gracefully degrades to the heuristic result when the `AI` binding is not
 * attached or if the model output fails strict schema validation.
 * ============================================================================
 */

import type {
  ExtractedRawRecipe,
  IngredientRow,
  TrnRecipeDocument,
  WorkerEnv,
} from '../shared/types';
import {
  buildContiguousTrnGraph,
  extractHardwareAndTemps,
  parseIngredientLine,
} from './heuristicParser';

// ============================================================================
// Configuration Constants
// ============================================================================

/** Heuristic confidence threshold below which Workers AI fallback activates. */
export const AI_CONFIDENCE_THRESHOLD = 0.55;

/** Default Cloudflare Workers AI instruct model used for structured JSON parsing. */
const WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

/** Expected JSON structure returned by the Workers AI extraction prompt. */
interface AiParsedPayload {
  title?: string;
  ingredients?: Array<{
    line: string;
    stepIndex: number;
    isDividedSplit?: boolean;
    partLabel?: string;
  }>;
  steps?: string[];
}

// ============================================================================
// Decision & Invocation Logic
// ============================================================================

/**
 * Determines whether a compiled heuristic document should be refined by
 * Cloudflare Workers AI.
 *
 * @param heuristicDoc - Initial document produced by `buildTrnDocumentHeuristic`.
 * @param preferAi - Optional user override requesting AI refinement.
 * @returns True if AI fallback should run when `env.AI` is bound.
 */
export function shouldTriggerAiFallback(
  heuristicDoc: TrnRecipeDocument,
  preferAi?: boolean
): boolean {
  if (preferAi) return true;
  if (heuristicDoc.metadata.confidenceScore < AI_CONFIDENCE_THRESHOLD) return true;
  if (heuristicDoc.ingredients.length <= 1 && heuristicDoc.actions.length <= 1) return true;
  return false;
}

/**
 * Attempts to refine a low-confidence recipe using Cloudflare Workers AI
 * (`env.AI`), preserving strict topological row contiguity and falling back
 * cleanly to `heuristicDoc` on any binding absence or validation error.
 *
 * @param raw - Intermediate extracted recipe strings.
 * @param heuristicDoc - Baseline deterministic TRN document.
 * @param env - Cloudflare Worker bindings containing optional `AI`.
 * @returns Refined TrnRecipeDocument or original `heuristicDoc`.
 */
export async function parseWithWorkersAiFallback(
  raw: ExtractedRawRecipe,
  heuristicDoc: TrnRecipeDocument,
  env?: WorkerEnv
): Promise<TrnRecipeDocument> {
  if (!env?.AI) {
    return heuristicDoc;
  }

  try {
    const prompt = buildAiPrompt(raw);
    const aiResult = (await env.AI.run(WORKERS_AI_MODEL, {
      messages: [
        {
          role: 'system',
          content:
            'You are a precision culinary compiler. Output ONLY valid JSON matching the requested schema, with no markdown prose. Split divided ingredients across the exact 0-based step indices where each portion is used.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1800,
      temperature: 0.1,
    })) as { response?: string } | null;

    const rawText = aiResult && typeof aiResult.response === 'string' ? aiResult.response : '';
    if (!rawText) {
      return heuristicDoc;
    }

    const parsedJson = extractJsonObject(rawText);
    if (!parsedJson || !Array.isArray(parsedJson.ingredients) || !Array.isArray(parsedJson.steps)) {
      return heuristicDoc;
    }

    const cleanSteps = parsedJson.steps
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter((s) => s.length > 0);
    if (cleanSteps.length === 0) {
      return heuristicDoc;
    }

    // Parse AI-mapped ingredient lines and clamp step indices to valid bounds
    const mappedIngredients: IngredientRow[] = parsedJson.ingredients
      .filter((item) => item && typeof item.line === 'string' && item.line.trim().length > 0)
      .map((item, idx) => {
        const parsedRow = parseIngredientLine(item.line, idx);
        const clampedStep = Math.max(
          0,
          Math.min(
            cleanSteps.length - 1,
            Number.isFinite(item.stepIndex) ? Math.floor(item.stepIndex) : 0
          )
        );
        return {
          ...parsedRow,
          isDividedSplit: Boolean(item.isDividedSplit),
          dividedPartLabel: item.partLabel,
          firstUsedStepIndex: clampedStep,
        };
      });

    if (mappedIngredients.length === 0) {
      return heuristicDoc;
    }

    // Sort topologically so rows entering in the same step remain strictly contiguous
    const orderedIngredients = [...mappedIngredients].sort(
      (a, b) => a.firstUsedStepIndex - b.firstUsedStepIndex
    );

    const { hardware, criticalTemperatures, stepParams } = extractHardwareAndTemps(cleanSteps);
    const { actions, summaryRows } = buildContiguousTrnGraph(
      orderedIngredients,
      cleanSteps,
      stepParams
    );

    const usedHybrid = heuristicDoc.metadata.confidenceScore >= 0.4;

    return {
      ...heuristicDoc,
      title: parsedJson.title?.trim() || heuristicDoc.title,
      metadata: {
        ...heuristicDoc.metadata,
        hardware: hardware.length > 0 ? hardware : heuristicDoc.metadata.hardware,
        criticalTemperatures:
          criticalTemperatures.length > 0
            ? criticalTemperatures
            : heuristicDoc.metadata.criticalTemperatures,
        parserEngine: usedHybrid ? 'hybrid' : 'workers-ai',
        confidenceScore: Math.max(heuristicDoc.metadata.confidenceScore, 0.85),
      },
      ingredients: orderedIngredients,
      actions,
      summaryRows,
    };
  } catch {
    // Gracefully fall back to heuristic output if Workers AI throws or times out
    return heuristicDoc;
  }
}

// ============================================================================
// Prompt & JSON Extraction Helpers
// ============================================================================

/**
 * Formats the raw recipe payload into a compact prompt for Workers AI.
 */
function buildAiPrompt(raw: ExtractedRawRecipe): string {
  const ingBlock = raw.rawIngredients.slice(0, 60).join('\n');
  const stepBlock = raw.rawInstructions
    .slice(0, 30)
    .map((s, idx) => `${idx}: ${s}`)
    .join('\n');

  return [
    `Title: ${raw.title}`,
    'Raw Ingredients:',
    ingBlock || '(none)',
    '',
    'Raw Steps (0-indexed):',
    stepBlock || '(none)',
    '',
    'Return ONLY JSON with shape:',
    '{"title":"string","steps":["concise step 1","concise step 2"],"ingredients":[{"line":"amount unit ingredient, prep","stepIndex":0,"isDividedSplit":false,"partLabel":""}]}',
  ].join('\n');
}

/**
 * Extracts and parses the first valid JSON object inside an LLM string response.
 */
function extractJsonObject(text: string): AiParsedPayload | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text.trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as AiParsedPayload;
  } catch {
    return null;
  }
}
