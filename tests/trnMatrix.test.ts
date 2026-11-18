/**
 * ============================================================================
 * Unit Tests — TRN Grid Matrix Geometry & Row Mutation Helpers
 * ============================================================================
 */

import { describe, expect, it } from './testHarness';
import {
  addBlankIngredientRow,
  buildTrnGridMatrix,
  removeIngredientRowFromDoc,
  splitIngredientRowInDoc,
  type TrnGridMatrix,
} from '../src/client/utils/trnMatrix';
import { loadSamplePresetDocument } from '../src/client/utils/sampleRecipes';

/**
 * Verifies the strict HTML table invariant: every coordinate (r, c) inside
 * [0..rowCount-1] x [0..columnCount-1] is covered by EXACTLY one cell with
 * zero overlaps and zero gaps.
 */
function assertRectangularCoverage(matrix: TrnGridMatrix): void {
  const counts: number[][] = Array.from({ length: matrix.rowCount }, () =>
    Array.from({ length: matrix.columnCount }, () => 0)
  );

  for (let r = 0; r < matrix.rowCount; r += 1) {
    const rowCells = matrix.cellsByRow[r];
    expect(rowCells).toBeDefined();

    for (const cell of rowCells) {
      expect(cell.rowSpan).toBeGreaterThanOrEqual(1);
      expect(cell.colSpan).toBeGreaterThanOrEqual(1);
      expect(r + cell.rowSpan).toBeLessThanOrEqual(matrix.rowCount);
      expect(cell.colStart + cell.colSpan).toBeLessThanOrEqual(matrix.columnCount);

      for (let rr = r; rr < r + cell.rowSpan; rr += 1) {
        for (let cc = cell.colStart; cc < cell.colStart + cell.colSpan; cc += 1) {
          counts[rr][cc] += 1;
        }
      }
    }
  }

  for (let r = 0; r < matrix.rowCount; r += 1) {
    for (let c = 0; c < matrix.columnCount; c += 1) {
      expect(counts[r][c]).toBe(1);
    }
  }
}

describe('buildTrnGridMatrix', () => {
  it('generates a gap-free, non-overlapping matrix for all preset recipes', () => {
    for (const presetId of [
      'brown-butter-cookies',
      'pan-seared-ribeye',
      'buttermilk-pancakes',
    ]) {
      const doc = loadSamplePresetDocument(presetId);
      const matrix = buildTrnGridMatrix(doc);

      expect(matrix.rowCount).toBe(doc.ingredients.length);
      expect(matrix.columnCount).toBeGreaterThanOrEqual(2);
      assertRectangularCoverage(matrix);
    }
  });

  it('maintains valid rectangular matrix after splitting, adding, and removing rows', () => {
    let doc = loadSamplePresetDocument('buttermilk-pancakes');
    const initialCount = doc.ingredients.length;

    doc = splitIngredientRowInDoc(doc, doc.ingredients[0].id);
    expect(doc.ingredients.length).toBe(initialCount + 1);
    assertRectangularCoverage(buildTrnGridMatrix(doc));

    doc = addBlankIngredientRow(doc);
    expect(doc.ingredients.length).toBe(initialCount + 2);
    assertRectangularCoverage(buildTrnGridMatrix(doc));

    doc = removeIngredientRowFromDoc(doc, doc.ingredients[0].id);
    expect(doc.ingredients.length).toBe(initialCount + 1);
    assertRectangularCoverage(buildTrnGridMatrix(doc));
  });
});
