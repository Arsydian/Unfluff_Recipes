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
import {
  buildTrnDocumentHeuristic,
  extractRecipeFromRawText,
} from '../src/worker/heuristicParser';

const COOKIE_TEST_RECIPE = `Brown Butter Chocolate Chip Cookies
Prep Time: 20 min
Cook Time: 12 min
Yield: 24 cookies

Ingredients:
- 1 cup unsalted butter
- 2 1/4 cups all-purpose flour
- 1 tsp baking soda
- 1 tsp kosher salt, divided
- 3/4 cup dark brown sugar
- 1/2 cup granulated sugar
- 2 large eggs
- 1 1/2 cups dark chocolate chips

Instructions:
1. Melt the unsalted butter in a saucepan over medium heat until browned, 5 minutes.
2. Meanwhile, in a separate bowl, whisk together the all-purpose flour, baking soda, and 1/2 tsp kosher salt.
3. Beat brown sugar, granulated sugar, and eggs into the cooled brown butter.
4. Fold dry ingredients into the butter mixture, then stir in dark chocolate chips.
5. Sprinkle with remaining 1/2 tsp kosher salt and bake at 375°F for 10-12 minutes.`;

const PANCAKE_TEST_RECIPE = `Buttermilk Pancakes
Yield: 12 pancakes

Ingredients:
- 2 cups all-purpose flour
- 2 tbsp granulated sugar
- 2 tsp baking powder
- 2 cups buttermilk
- 2 large eggs
- 4 tbsp unsalted butter, melted

Instructions:
1. Whisk flour, sugar, and baking powder in a mixing bowl.
2. Meanwhile, in a separate bowl, whisk buttermilk, eggs, and melted butter.
3. Stir wet ingredients into dry ingredients until just combined.
4. Cook on a 350°F skillet 2-3 minutes per side.`;

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
  it('generates a gap-free, non-overlapping matrix for multi-branch recipes', () => {
    for (const rawText of [COOKIE_TEST_RECIPE, PANCAKE_TEST_RECIPE]) {
      const doc = buildTrnDocumentHeuristic(extractRecipeFromRawText(rawText));
      const matrix = buildTrnGridMatrix(doc);

      expect(matrix.rowCount).toBe(doc.ingredients.length);
      expect(matrix.columnCount).toBeGreaterThanOrEqual(2);
      assertRectangularCoverage(matrix);
    }
  });

  it('maintains valid rectangular matrix after splitting, adding, and removing rows', () => {
    let doc = buildTrnDocumentHeuristic(extractRecipeFromRawText(PANCAKE_TEST_RECIPE));
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
