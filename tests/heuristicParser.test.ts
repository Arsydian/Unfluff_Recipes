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

  it('parses attached metric quantities and leading state modifiers', () => {
    const snaps = parseIngredientLine('170g ginger snaps (about 1 1/2 c crumbs)', 0);
    expect(snaps.quantity).toBe(170);
    expect(snaps.unit).toBe('g');
    expect(snaps.name).toBe('ginger snaps');
    expect(snaps.prepNote).toBe('about 1 1/2 c crumbs');

    const sugar = parseIngredientLine('25g (2 tbsp) granulated sugar', 1);
    expect(sugar.quantity).toBe(25);
    expect(sugar.unit).toBe('g');
    expect(sugar.name).toBe('granulated sugar');
    expect(sugar.prepNote).toBe('2 tbsp');

    const butter = parseIngredientLine('56g (4 tbsp) unsalted butter, melted', 2);
    expect(butter.quantity).toBe(56);
    expect(butter.unit).toBe('g');
    expect(butter.name).toBe('unsalted butter');
    expect(butter.prepNote).toContain('melted');

    const cheese = parseIngredientLine('6 oz softened cream cheese', 3);
    expect(cheese.quantity).toBe(6);
    expect(cheese.unit).toBe('oz');
    expect(cheese.name).toBe('cream cheese');
    expect(cheese.prepNote).toBe('softened');
  });
});

describe('Multi-Component & Compound Ingredient Matching', () => {
  it('pins repeated multi-component ingredients to their respective steps and matches compound nouns', () => {
    const doc = buildTrnDocumentHeuristic({
      title: 'Pumpkin Pie',
      servings: 8,
      yieldLabel: '1 pie',
      extractionMethod: 'html-heuristic',
      rawIngredients: [
        '170g ginger snaps (about 1 1/2 c crumbs)',
        '25g (2 tbsp) granulated sugar',
        '1/2 tsp fine salt',
        '56g (4 tbsp) unsalted butter, melted',
        '1 (15-oz) can pumpkin puree',
        '1/2 tsp fine salt',
        '4 tbsp unsalted butter',
        '1 1/2 tbsp pumpkin pie spice',
        '6 oz softened cream cheese',
        '2 tbsp granulated sugar',
        '1/4 to 1/2 tsp fine salt',
        '1 1/2 c heavy whipping cream',
      ],
      rawInstructions: [
        'Make the crust: Combine gingersnaps, sugar, and salt, then drizzle in melted butter.',
        'Bake crust at 325F for 20 minutes.',
        'Make the filling: Whisk pumpkin puree and salt in a bowl.',
        'Melt the butter in a saucepan and add the spices for 30 seconds.',
        'For the cream: Stir together cream cheese, sugar, and 1/4 teaspoon salt, then add remaining cream and whip.',
      ],
    });

    const saltRows = doc.ingredients.filter((i) => i.name === 'fine salt');
    expect(saltRows).toHaveLength(3);
    expect(saltRows.map((r) => r.firstUsedStepIndex)).toEqual([0, 2, 4]);

    const sugarRows = doc.ingredients.filter((i) => i.name === 'granulated sugar');
    expect(sugarRows).toHaveLength(2);
    expect(sugarRows.map((r) => r.firstUsedStepIndex)).toEqual([0, 4]);

    const butterRows = doc.ingredients.filter((i) => i.name === 'unsalted butter');
    expect(butterRows).toHaveLength(2);
    expect(butterRows.map((r) => r.firstUsedStepIndex)).toEqual([0, 3]);

    const snaps = doc.ingredients.find((i) => i.name === 'ginger snaps');
    expect(snaps?.firstUsedStepIndex).toBe(0);

    const spice = doc.ingredients.find((i) => i.name === 'pumpkin pie spice');
    expect(spice?.firstUsedStepIndex).toBe(3);

    const cream = doc.ingredients.find((i) => i.name === 'heavy whipping cream');
    expect(cream?.firstUsedStepIndex).toBe(4);
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
