/**
 * ============================================================================
 * Culinary Batch Scaling, Unit Conversion & Inline Temperature Engine
 * ----------------------------------------------------------------------------
 * Handles:
 *   1. Arbitrary serving/batch multipliers (0.5x, 1x, 2x, custom servings).
 *   2. Density-aware US Imperial <-> Metric conversions (e.g., 1 cup flour ->
 *      120 g, 1 cup sugar -> 200 g, 1 cup butter -> 227 g, liquids -> mL/L).
 *   3. Crisp engineering fraction formatting (Imperial) & decimal formatting (Metric).
 *   4. Inline temperature rewriting inside instruction text (°F <-> °C).
 * ============================================================================
 */

import type { IngredientRow, UnitSystem } from '../../shared/types';

// ============================================================================
// Culinary Density & Volume Lookup Tables
// ============================================================================

/** Weight in grams per 1 US Cup (240 mL) for common dry & semi-solid ingredients. */
const DENSITY_GRAMS_PER_CUP: Array<{ pattern: RegExp; gramsPerCup: number }> = [
  { pattern: /\b(?:cake|pastry)\s+flour\b/i, gramsPerCup: 115 },
  { pattern: /\b(?:whole\s+wheat|bread)\s+flour\b/i, gramsPerCup: 130 },
  { pattern: /\b(?:all[- ]purpose|ap)?\s*flour\b/i, gramsPerCup: 120 },
  { pattern: /\bcornstarch\b|\bcorn\s+starch\b/i, gramsPerCup: 128 },
  { pattern: /\bcocoa\s+powder\b|\bcocoa\b/i, gramsPerCup: 100 },
  { pattern: /\b(?:powdered|confectioners?|icing)\s+sugar\b/i, gramsPerCup: 120 },
  { pattern: /\bbrown\s+sugar\b/i, gramsPerCup: 215 },
  { pattern: /\b(?:granulated|white|caster)?\s*sugar\b/i, gramsPerCup: 200 },
  { pattern: /\bbutter\b/i, gramsPerCup: 227 },
  { pattern: /\bhoney\b|\bmaple\s+syrup\b|\bcorn\s+syrup\b|\bmolasses\b/i, gramsPerCup: 340 },
  { pattern: /\b(?:olive|vegetable|canola|coconut|sesame|avocado)?\s*oil\b/i, gramsPerCup: 218 },
  { pattern: /\bpeanut\s+butter\b|\balmond\s+butter\b|\btahini\b/i, gramsPerCup: 258 },
  { pattern: /\brolled\s+oats\b|\boats\b/i, gramsPerCup: 90 },
  { pattern: /\brice\b/i, gramsPerCup: 185 },
  { pattern: /\bchocolate\s+chips\b|\bchopped\s+chocolate\b/i, gramsPerCup: 170 },
  { pattern: /\b(?:walnuts|pecans|almonds|cashews|hazelnuts|peanuts)\b/i, gramsPerCup: 120 },
  { pattern: /\b(?:parmesan|cheddar|mozzarella|gruyere|cheese)\b/i, gramsPerCup: 110 },
  { pattern: /\b(?:kosher\s+)?salt\b/i, gramsPerCup: 288 }, // 6g per tsp -> 288g per cup
  { pattern: /\bbaking\s+(?:powder|soda)\b/i, gramsPerCup: 220 },
  { pattern: /\bcream\s+cheese\b/i, gramsPerCup: 227 },
  { pattern: /\bsour\s+cream\b|\byogurt\b/i, gramsPerCup: 240 },
];

/** Multipliers converting US culinary volumetric units into US cups. */
const VOLUME_TO_CUPS: Record<string, number> = {
  cup: 1,
  tbsp: 1 / 16,
  tsp: 1 / 48,
  'fl oz': 1 / 8,
  pt: 2,
  qt: 4,
  gal: 16,
};

/** Unicode fraction glyphs paired with decimal thresholds for clean Imperial display. */
const DISPLAY_FRACTIONS: Array<[number, string]> = [
  [0.125, '⅛'],
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.375, '⅜'],
  [0.5, '½'],
  [0.625, '⅝'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
  [0.875, '⅞'],
];

// ============================================================================
// Scaling & Formatting
// ============================================================================

/**
 * Multiplies a numeric ingredient quantity by a batch scale factor.
 *
 * @param qty - Base numeric quantity (or null for non-numeric like "to taste").
 * @param scaleFactor - Positive batch multiplier (e.g., 0.5, 1, 2).
 * @returns Scaled quantity or null.
 */
export function scaleQuantity(qty: number | null, scaleFactor: number): number | null {
  if (qty === null || !Number.isFinite(qty)) return null;
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return qty;
  return qty * scaleFactor;
}

/**
 * Formats a scaled quantity into crisp engineering notation:
 * - Metric mode renders clean rounded integers/decimals.
 * - Original/Imperial mode snaps common culinary fractions into Unicode glyphs.
 */
export function formatTechnicalQuantity(
  qty: number | null,
  unitSystem: UnitSystem
): string {
  if (qty === null || !Number.isFinite(qty)) return '';

  if (unitSystem === 'metric') {
    if (qty >= 100) return String(Math.round(qty));
    if (qty >= 10) return Number(qty.toFixed(1)).toString();
    return Number(qty.toFixed(2)).toString();
  }

  // Snap near-exact culinary fractions for US Imperial / Original display
  const roundedBase = Math.round(qty * 24) / 24;
  const whole = Math.floor(roundedBase + 1e-6);
  const remainder = roundedBase - whole;

  if (remainder < 0.05) {
    return String(whole);
  }
  if (remainder > 0.95) {
    return String(whole + 1);
  }

  for (const [val, glyph] of DISPLAY_FRACTIONS) {
    if (Math.abs(remainder - val) <= 0.045) {
      return whole > 0 ? `${whole} ${glyph}` : glyph;
    }
  }

  return Number(qty.toFixed(2)).toString();
}

// ============================================================================
// Unit Conversion (Original <-> Metric <-> US Imperial)
// ============================================================================

/**
 * Looks up estimated ingredient density in grams per US cup, or null if liquid.
 */
function findIngredientDensity(ingredientName: string): number | null {
  for (const entry of DENSITY_GRAMS_PER_CUP) {
    if (entry.pattern.test(ingredientName)) {
      return entry.gramsPerCup;
    }
  }
  return null;
}

/**
 * Converts a single numeric quantity + unit into the requested target system.
 */
function convertSingleValue(
  value: number,
  unit: string,
  ingredientName: string,
  unitSystem: UnitSystem
): { amount: number; unit: string } {
  if (unitSystem === 'original' || !unit) {
    return { amount: value, unit };
  }

  const normalized = unit.trim();

  if (unitSystem === 'metric') {
    if (normalized === 'g') {
      return value >= 1000
        ? { amount: value / 1000, unit: 'kg' }
        : { amount: value, unit: 'g' };
    }
    if (normalized === 'kg') {
      return { amount: value, unit: 'kg' };
    }
    if (normalized === 'mL') {
      return value >= 1000
        ? { amount: value / 1000, unit: 'L' }
        : { amount: value, unit: 'mL' };
    }
    if (normalized === 'L') {
      return { amount: value, unit: 'L' };
    }
    if (normalized === 'lb') {
      const grams = value * 453.592;
      return grams >= 1000
        ? { amount: grams / 1000, unit: 'kg' }
        : { amount: grams, unit: 'g' };
    }
    if (normalized === 'oz') {
      const grams = value * 28.3495;
      return grams >= 1000
        ? { amount: grams / 1000, unit: 'kg' }
        : { amount: grams, unit: 'g' };
    }
    if (normalized === 'stick') {
      return { amount: value * 113.4, unit: 'g' };
    }
    if (normalized in VOLUME_TO_CUPS) {
      const cups = value * VOLUME_TO_CUPS[normalized];
      const density = findIngredientDensity(ingredientName);
      // Use grams for known dry/fat solids (except fl oz which is explicitly liquid)
      if (density !== null && normalized !== 'fl oz') {
        const grams = cups * density;
        return grams >= 1000
          ? { amount: grams / 1000, unit: 'kg' }
          : { amount: grams, unit: 'g' };
      }
      // Liquid volume conversion (1 US cup = 240 mL, 1 tbsp = 15 mL, 1 tsp = 5 mL)
      const ml = cups * 240;
      return ml >= 1000
        ? { amount: ml / 1000, unit: 'L' }
        : { amount: ml, unit: 'mL' };
    }

    return { amount: value, unit };
  }

  // Target: US Imperial
  if (normalized === 'g') {
    return value >= 453.592
      ? { amount: value / 453.592, unit: 'lb' }
      : { amount: value / 28.3495, unit: 'oz' };
  }
  if (normalized === 'kg') {
    return { amount: (value * 1000) / 453.592, unit: 'lb' };
  }
  if (normalized === 'mL' || normalized === 'L') {
    const ml = normalized === 'L' ? value * 1000 : value;
    if (ml >= 60) {
      return { amount: ml / 240, unit: 'cup' };
    }
    if (ml >= 15) {
      return { amount: ml / 15, unit: 'tbsp' };
    }
    return { amount: ml / 5, unit: 'tsp' };
  }

  return { amount: value, unit };
}

/**
 * Produces display-ready quantity and unit strings for an IngredientRow under
 * the current batch scale factor and unit system.
 *
 * @param row - Source IngredientRow.
 * @param scaleFactor - Serving multiplier (e.g., 1, 2, 0.5).
 * @param unitSystem - Target display system ('original' | 'metric' | 'imperial').
 * @returns Formatted `displayQty` and `displayUnit`.
 */
export function convertIngredientUnit(
  row: IngredientRow,
  scaleFactor: number,
  unitSystem: UnitSystem
): { displayQty: string; displayUnit: string } {
  const scaledMin = scaleQuantity(row.quantity, scaleFactor);
  if (scaledMin === null) {
    return {
      displayQty: row.rawQuantity || '-',
      displayUnit: row.unit,
    };
  }

  const convertedMin = convertSingleValue(
    scaledMin,
    row.unit,
    row.name,
    unitSystem
  );
  const formattedMin = formatTechnicalQuantity(convertedMin.amount, unitSystem);

  if (row.quantityMax !== null && row.quantityMax !== undefined) {
    const scaledMax = scaleQuantity(row.quantityMax, scaleFactor);
    if (scaledMax !== null) {
      const convertedMax = convertSingleValue(
        scaledMax,
        row.unit,
        row.name,
        unitSystem
      );
      const formattedMax = formatTechnicalQuantity(convertedMax.amount, unitSystem);
      return {
        displayQty: `${formattedMin}-${formattedMax}`,
        displayUnit: convertedMin.unit,
      };
    }
  }

  return {
    displayQty: formattedMin,
    displayUnit: convertedMin.unit,
  };
}

// ============================================================================
// Inline Step & Spec Temperature Conversion (°F <-> °C)
// ============================================================================

/**
 * Rewrites embedded temperatures inside instruction steps or spec badges when
 * toggling between Metric (°C) and US Imperial (°F). Leaves text unchanged in
 * `'original'` mode.
 *
 * @param text - Instruction or temperature string.
 * @param unitSystem - Active display unit system.
 * @returns Text with temperatures converted if needed.
 */
export function convertInlineTemperatures(
  text: string,
  unitSystem: UnitSystem
): string {
  if (!text || unitSystem === 'original') {
    return text;
  }

  if (unitSystem === 'metric') {
    // Convert Fahrenheit values (°F / degrees F) -> Celsius (°C)
    return text.replace(
      /\b(-?\d{2,3})\s*(?:°|deg(?:rees?)?\.?\s*)?\s*(?:F|Fahrenheit)\b/gi,
      (_match, degStr: string) => {
        const f = Number(degStr);
        const c = Math.round(((f - 32) * 5) / 9);
        return `${c}°C`;
      }
    );
  }

  // Convert Celsius values (°C / degrees C) -> Fahrenheit (°F)
  return text.replace(
    /\b(-?\d{2,3})\s*(?:°|deg(?:rees?)?\.?\s*)?\s*(?:C|Celsius)\b/gi,
    (_match, degStr: string) => {
      const c = Number(degStr);
      const f = Math.round((c * 9) / 5 + 32);
      return `${f}°F`;
    }
  );
}
