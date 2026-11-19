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
type AiStepInput =
  | string
  | {
      instruction?: string;
      text?: string;
      step?: string;
      description?: string;
      verb?: string;
      outputLabel?: string;
    };

type AiIngredientInput =
  | string
  | {
      line?: string;
      ingredient?: string;
      text?: string;
      name?: string;
      amount?: string | number;
      quantity?: string | number;
      unit?: string;
      stepIndex?: number;
      step?: number;
      stepNumber?: number;
      isDividedSplit?: boolean;
      partLabel?: string;
    };

interface AiParsedPayload {
  title?: string;
  ingredients?: AiIngredientInput[];
  steps?: AiStepInput[];
  instructions?: AiStepInput[];
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
 * Attempts to refine a low-confidence or AI-assisted recipe using Cloudflare
 * Workers AI (`env.AI`), preserving strict topological row contiguity and
 * falling back cleanly to `heuristicDoc` on binding absence or validation error.
 *
 * @param raw - Intermediate extracted recipe strings.
 * @param heuristicDoc - Baseline deterministic TRN document.
 * @param env - Cloudflare Worker bindings containing optional `AI`.
 * @param warnings - Optional array to collect diagnostic fallback notices.
 * @returns Refined TrnRecipeDocument or original `heuristicDoc`.
 */
export async function parseWithWorkersAiFallback(
  raw: ExtractedRawRecipe,
  heuristicDoc: TrnRecipeDocument,
  env?: WorkerEnv,
  warnings?: string[]
): Promise<TrnRecipeDocument> {
  if (!env?.AI) {
    return heuristicDoc;
  }

  try {
    const prompt = buildAiPrompt(raw);
    const aiResult = await env.AI.run(WORKERS_AI_MODEL, {
      messages: [
        {
          role: 'system',
          content:
            'You are a precision culinary compiler. Output ONLY valid JSON matching the requested schema, with no markdown prose. De-fluff blog chatter into concise imperative steps, and split divided ingredients across the exact 0-based step indices where each portion is used.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2048,
      temperature: 0.1,
    });

    const parsedJson = unwrapAiResponsePayload(aiResult);
    const rawStepList = parsedJson?.steps ?? parsedJson?.instructions;
    if (!parsedJson || !Array.isArray(parsedJson.ingredients) || !Array.isArray(rawStepList)) {
      warnings?.push(
        'Workers AI did not return a valid recipe JSON structure; displaying deterministic heuristic compilation.'
      );
      return heuristicDoc;
    }

    const normalizedSteps: Array<{ text: string; verb?: string; outputLabel?: string }> = [];
    for (const entry of rawStepList) {
      if (typeof entry === 'string') {
        const text = entry.trim();
        if (text) normalizedSteps.push({ text });
      } else if (entry && typeof entry === 'object') {
        const text = String(
          entry.instruction ?? entry.text ?? entry.step ?? entry.description ?? ''
        ).trim();
        if (text) {
          normalizedSteps.push({
            text,
            verb: typeof entry.verb === 'string' && entry.verb.trim() ? entry.verb.trim().toUpperCase() : undefined,
            outputLabel:
              typeof entry.outputLabel === 'string' && entry.outputLabel.trim()
                ? entry.outputLabel.trim()
                : undefined,
          });
        }
      }
    }

    const cleanSteps = normalizedSteps.map((s) => s.text);
    if (cleanSteps.length === 0) {
      warnings?.push(
        'Workers AI returned zero recipe steps; displaying deterministic heuristic compilation.'
      );
      return heuristicDoc;
    }

    // Parse AI-mapped ingredient lines and clamp step indices to valid bounds
    const mappedIngredients: IngredientRow[] = [];
    for (const item of parsedJson.ingredients) {
      let line = '';
      let rawStepIdx = 0;
      let isDividedSplit = false;
      let partLabel: string | undefined;

      if (typeof item === 'string') {
        line = item.trim();
      } else if (item && typeof item === 'object') {
        const composed = [item.amount ?? item.quantity, item.unit, item.name]
          .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
          .join(' ')
          .trim();
        line = String(item.line ?? item.ingredient ?? item.text ?? composed).trim();
        if (typeof item.stepIndex === 'number' && Number.isFinite(item.stepIndex)) {
          rawStepIdx = Math.floor(item.stepIndex);
        } else if (typeof item.step === 'number' && Number.isFinite(item.step)) {
          rawStepIdx = Math.floor(item.step);
        } else if (typeof item.stepNumber === 'number' && Number.isFinite(item.stepNumber)) {
          rawStepIdx = Math.floor(item.stepNumber) - 1;
        }
        isDividedSplit = Boolean(item.isDividedSplit);
        partLabel = typeof item.partLabel === 'string' && item.partLabel.trim() ? item.partLabel.trim() : undefined;
      }

      if (!line) continue;
      const parsedRow = parseIngredientLine(line, mappedIngredients.length);
      const clampedStep = Math.max(0, Math.min(cleanSteps.length - 1, rawStepIdx));
      mappedIngredients.push({
        ...parsedRow,
        isDividedSplit,
        dividedPartLabel: partLabel,
        firstUsedStepIndex: clampedStep,
      });
    }

    if (mappedIngredients.length === 0) {
      warnings?.push(
        'Workers AI returned zero ingredients; displaying deterministic heuristic compilation.'
      );
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

    // Apply optional AI verb and intermediate outputLabel refinements
    for (let i = 0; i < actions.length; i += 1) {
      const override = normalizedSteps[i];
      if (!override) continue;
      if (override.verb) {
        actions[i].verb = override.verb.slice(0, 18);
      }
      if (override.outputLabel && i < actions.length - 1) {
        actions[i].outputLabel = override.outputLabel;
        if (summaryRows[i]) {
          summaryRows[i].outputLabel = override.outputLabel;
        }
      }
    }

    const usedHybrid =
      heuristicDoc.metadata.confidenceScore >= 0.4 && raw.rawIngredients.length > 0;

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
        confidenceScore: Math.max(heuristicDoc.metadata.confidenceScore, 0.88),
      },
      ingredients: orderedIngredients,
      actions,
      summaryRows,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    warnings?.push(
      `Workers AI refinement failed (${detail}); displaying deterministic heuristic compilation.`
    );
    return heuristicDoc;
  }
}

// ============================================================================
// Prompt & JSON Extraction Helpers
// ============================================================================

/**
 * Formats the raw recipe payload into a compact, token-bounded prompt for Workers AI.
 */
function buildAiPrompt(raw: ExtractedRawRecipe): string {
  const needsBodyExcerpt =
    (raw.rawIngredients.length === 0 || raw.rawInstructions.length <= 1) &&
    Boolean(raw.rawBodyExcerpt);

  if (needsBodyExcerpt && raw.rawBodyExcerpt) {
    return [
      `Title: ${raw.title}`,
      'Extract the actual recipe (ignoring blog essay/comments) from this page excerpt:',
      raw.rawBodyExcerpt.slice(0, 4500),
      '',
      'Return ONLY JSON with shape:',
      '{"title":"string","steps":[{"instruction":"concise imperative step","verb":"WHISK","outputLabel":"Sub-Assembly"}],"ingredients":[{"line":"amount unit ingredient, prep","stepIndex":0,"isDividedSplit":false,"partLabel":""}]}',
    ].join('\n');
  }

  const ingBlock = raw.rawIngredients.slice(0, 60).join('\n');
  const stepBlock = raw.rawInstructions
    .slice(0, 30)
    .map((s, idx) => `${idx}: ${s.slice(0, 600)}`)
    .join('\n')
    .slice(0, 4200);

  return [
    `Title: ${raw.title}`,
    'Raw Ingredients:',
    ingBlock || '(none)',
    '',
    'Raw Steps (0-indexed):',
    stepBlock || '(none)',
    '',
    'De-fluff conversational prose into crisp imperative steps and map every ingredient to its 0-based stepIndex. Return ONLY JSON with shape:',
    '{"title":"string","steps":[{"instruction":"concise imperative step","verb":"WHISK","outputLabel":"Sub-Assembly"}],"ingredients":[{"line":"amount unit ingredient, prep","stepIndex":0,"isDividedSplit":false,"partLabel":""}]}',
  ].join('\n');
}

/**
 * Unwraps string, pre-parsed object, or OpenAI-shaped Workers AI responses.
 */
function unwrapAiResponsePayload(aiResult: unknown): AiParsedPayload | null {
  if (!aiResult) return null;
  if (typeof aiResult === 'string') {
    return extractJsonObject(aiResult);
  }
  if (typeof aiResult !== 'object') return null;

  const record = aiResult as Record<string, unknown>;

  if (typeof record.response === 'string') {
    return extractJsonObject(record.response);
  }
  if (record.response && typeof record.response === 'object') {
    return record.response as AiParsedPayload;
  }

  if (typeof record.result === 'string') {
    return extractJsonObject(record.result);
  }
  if (record.result && typeof record.result === 'object') {
    return record.result as AiParsedPayload;
  }

  if (Array.isArray(record.choices) && record.choices.length > 0) {
    const first = record.choices[0] as { message?: { content?: unknown }; text?: unknown };
    if (typeof first?.message?.content === 'string') {
      return extractJsonObject(first.message.content);
    }
    if (typeof first?.text === 'string') {
      return extractJsonObject(first.text);
    }
  }

  if (Array.isArray(record.ingredients) && (Array.isArray(record.steps) || Array.isArray(record.instructions))) {
    return record as unknown as AiParsedPayload;
  }

  return null;
}

/**
 * Extracts and parses the first valid JSON object inside an LLM string response,
 * tolerating markdown fences and minor trailing-comma formatting glitches.
 */
function extractJsonObject(text: string): AiParsedPayload | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text.trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  const jsonSlice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(jsonSlice) as AiParsedPayload;
  } catch {
    // Sanitize common LLM JSON artifacts (trailing commas, stray control chars)
    const sanitized = jsonSlice
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
    try {
      return JSON.parse(sanitized) as AiParsedPayload;
    } catch {
      return null;
    }
  }
}
