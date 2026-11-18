/**
 * ============================================================================
 * Unit Tests — Heuristic Parser, Divided Row Splitter & Spec Extraction
 * ============================================================================
 */

import { describe, expect, it } from './testHarness';
import {
  buildTrnDocumentHeuristic,
  extractHardwareAndTemps,
  extractRecipeFromRawText,
  parseIngredientLine,
  splitDividedIngredients,
} from '../src/worker/heuristicParser';

describe('parseIngredientLine', () => {
  it('parses Unicode fractions, units, names, and comma prep notes', () => {
    const row = parseIngredientLine('1 ½ cups all-purpose flour, sifted', 0);
    expect(row.quantity).toBeCloseTo(1.5, 4);
    expect(row.unit).toBe('cup');
    expect(row.name).toBe('all-purpose flour');
    expect(row.prepNote).toBe('sifted');
  });

  it('parses quantity ranges and parenthetical weight annotations', () => {
    const row = parseIngredientLine('2-3 cloves garlic (about 10g), minced', 1);
    expect(row.quantity).toBe(2);
    expect(row.quantityMax).toBe(3);
    expect(row.unit).toBe('clove');
    expect(row.name).toBe('garlic');
    expect(row.prepNote).toContain('about 10g');
    expect(row.prepNote).toContain('minced');
  });

  it('handles non-numeric "to taste" ingredients cleanly', () => {
    const row = parseIngredientLine('kosher salt to taste', 2);
    expect(row.quantity).toBeNull();
    expect(row.rawQuantity).toBe('to taste');
    expect(row.name.toLowerCase()).toContain('kosher salt');
  });
});

describe('Automatic Divided Ingredient Row Splitting', () => {
  it('splits a "divided" ingredient into separate step-pinned rows with proportional quantities', () => {
    const parsed = [
      parseIngredientLine('1 cup granulated sugar, divided', 0),
      parseIngredientLine('1/2 cup unsalted butter', 1),
    ];
    const instructions = [
      'Cream 1/2 cup sugar with the unsalted butter in a mixing bowl.',
      'Mix in dry ingredients to form a smooth batter.',
      'Sprinkle remaining sugar over the batter and bake at 350°F.',
    ];

    const split = splitDividedIngredients(parsed, instructions);
    const sugarParts = split.filter((r) => r.name.includes('sugar'));

    expect(sugarParts).toHaveLength(2);
    expect(sugarParts[0].isDividedSplit).toBe(true);
    expect(sugarParts[1].isDividedSplit).toBe(true);
    expect(sugarParts[0].quantity).toBeCloseTo(0.5, 4);
    expect(sugarParts[1].quantity).toBeCloseTo(0.5, 4);
    expect(sugarParts[0].firstUsedStepIndex).toBe(0);
    expect(sugarParts[1].firstUsedStepIndex).toBe(2);
  });

  it('sorts divided rows topologically in buildTrnDocumentHeuristic so rows remain contiguous', () => {
    const raw = extractRecipeFromRawText(`Skillet Herb Chicken
Prep Time: 10 min
Cook Time: 20 min
Yield: 4 servings

Ingredients:
- 2 tbsp olive oil, divided
- 4 chicken breasts
- 2 cloves garlic, minced

Instructions:
1. Heat 1 tbsp olive oil in a cast-iron skillet over medium-high heat and sear chicken until internal temperature reaches 165°F.
2. Add remaining olive oil and minced garlic to the skillet and sauté 1 minute.`);

    const doc = buildTrnDocumentHeuristic(raw);
    const oilParts = doc.ingredients.filter((i) => i.name.includes('olive oil'));

    expect(oilParts).toHaveLength(2);
    expect(oilParts[0].firstUsedStepIndex).toBe(0);
    expect(oilParts[1].firstUsedStepIndex).toBe(1);

    // Ensure ingredient rows are sorted monotonically by firstUsedStepIndex
    for (let i = 1; i < doc.ingredients.length; i += 1) {
      expect(doc.ingredients[i].firstUsedStepIndex).toBeGreaterThanOrEqual(
        doc.ingredients[i - 1].firstUsedStepIndex
      );
    }
  });
});

describe('extractHardwareAndTemps', () => {
  it('extracts cookware hardware, oven temps, internal temps, and durations without duplicate generic names', () => {
    const result = extractHardwareAndTemps([
      'Sear steaks in a cast-iron skillet until internal temp reaches 130°F on an instant-read thermometer, about 6 minutes.',
      'Transfer to a baking sheet in a 400°F oven for 5 minutes and rest on a wire cooling rack.',
    ]);

    expect(result.hardware).toContain('Cast-iron skillet');
    expect(result.hardware).not.toContain('Skillet');
    expect(result.hardware).toContain('Instant-read thermometer');
    expect(result.hardware).toContain('Baking sheet');
    expect(result.hardware).toContain('Oven');
    expect(result.hardware).toContain('Wire cooling rack');

    expect(result.criticalTemperatures).toContain('130°F (internal)');
    expect(result.criticalTemperatures).toContain('400°F');
    expect(result.stepParams[0].duration).toBe('6 min');
  });
});
