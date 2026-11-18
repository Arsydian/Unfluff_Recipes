/**
 * ============================================================================
 * Unit Tests — Culinary Batch Scaling, Unit Conversion & Temp Conversion
 * ============================================================================
 */

import { describe, expect, it } from './testHarness';
import {
  convertIngredientUnit,
  convertInlineTemperatures,
  formatTechnicalQuantity,
  scaleQuantity,
} from '../src/client/utils/unitConverter';
import type { IngredientRow } from '../src/shared/types';

function makeRow(partial: Partial<IngredientRow>): IngredientRow {
  return {
    id: 'ing-test',
    quantity: 1,
    rawQuantity: '1',
    unit: 'cup',
    name: 'all-purpose flour',
    prepNote: '',
    firstUsedStepIndex: 0,
    ...partial,
  };
}

describe('scaleQuantity & formatTechnicalQuantity', () => {
  it('scales quantities accurately and formats engineering Unicode fractions', () => {
    expect(scaleQuantity(1.5, 2)).toBe(3);
    expect(scaleQuantity(null, 2)).toBeNull();
    expect(formatTechnicalQuantity(1.5, 'imperial')).toBe('1 ½');
    expect(formatTechnicalQuantity(0.75, 'original')).toBe('¾');
    expect(formatTechnicalQuantity(120.4, 'metric')).toBe('120');
  });
});

describe('convertIngredientUnit', () => {
  it('converts US cups of dry/fat ingredients to Metric grams using culinary densities', () => {
    const flour = convertIngredientUnit(makeRow({ quantity: 1, unit: 'cup', name: 'all-purpose flour' }), 1, 'metric');
    expect(flour).toEqual({ displayQty: '120', displayUnit: 'g' });

    const sugar = convertIngredientUnit(makeRow({ quantity: 2, unit: 'cup', name: 'granulated sugar' }), 0.5, 'metric');
    expect(sugar).toEqual({ displayQty: '200', displayUnit: 'g' });

    const butter = convertIngredientUnit(makeRow({ quantity: 1, unit: 'cup', name: 'unsalted butter' }), 1, 'metric');
    expect(butter).toEqual({ displayQty: '227', displayUnit: 'g' });
  });

  it('converts liquid US volumes to Metric mL and L', () => {
    const milk = convertIngredientUnit(makeRow({ quantity: 1, unit: 'cup', name: 'buttermilk' }), 1, 'metric');
    expect(milk).toEqual({ displayQty: '240', displayUnit: 'mL' });

    const broth = convertIngredientUnit(makeRow({ quantity: 5, unit: 'cup', name: 'chicken broth' }), 1, 'metric');
    expect(broth).toEqual({ displayQty: '1.2', displayUnit: 'L' });
  });

  it('converts Metric grams and milliliters back to US Imperial units', () => {
    const steak = convertIngredientUnit(makeRow({ quantity: 454, unit: 'g', name: 'ribeye steak' }), 1, 'imperial');
    expect(steak).toEqual({ displayQty: '1', displayUnit: 'lb' });

    const liquid = convertIngredientUnit(makeRow({ quantity: 240, unit: 'mL', name: 'water' }), 1, 'imperial');
    expect(liquid).toEqual({ displayQty: '1', displayUnit: 'cup' });
  });
});

describe('convertInlineTemperatures', () => {
  it('converts °F to °C in metric mode and °C to °F in imperial mode', () => {
    expect(convertInlineTemperatures('Bake at 350°F for 12 min.', 'metric')).toBe(
      'Bake at 177°C for 12 min.'
    );
    expect(convertInlineTemperatures('Preheat oven to 180°C.', 'imperial')).toBe(
      'Preheat oven to 356°F.'
    );
    expect(convertInlineTemperatures('Bake at 350°F.', 'original')).toBe(
      'Bake at 350°F.'
    );
  });
});
