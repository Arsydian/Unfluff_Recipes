/**
 * ============================================================================
 * TRN Matrix Layout Compiler & Immutable Document Editing Helpers
 * ----------------------------------------------------------------------------
 * Converts a TrnRecipeDocument's DAG of `TrnActionNode` operations into exact
 * HTML `rowSpan` / `colSpan` grid coordinates so the classic "Cooking for
 * Engineers" merged dependency table forms a gap-free, non-overlapping matrix.
 *
 * Also provides immutable state helpers for inline editing, splitting divided
 * rows, reordering rows, and rebuilding synchronized Step Summary rows.
 * ============================================================================
 */

import type {
  IngredientRow,
  TrnActionNode,
  TrnRecipeDocument,
  TrnStepSummaryRow,
} from '../../shared/types';
import {
  buildContiguousTrnGraph,
  extractHardwareAndTemps,
} from '../../worker/heuristicParser';

// ============================================================================
// Matrix Cell Types
// ============================================================================

/** Discriminated cell rendered inside the right-hand action columns of NestedTrnTable. */
export type TrnGridCell =
  | {
      kind: 'action';
      key: string;
      node: TrnActionNode;
      rowSpan: number;
      colSpan: number;
      colStart: number;
    }
  | {
      kind: 'passthrough';
      key: string;
      rowSpan: number;
      colSpan: number;
      colStart: number;
    };

/** Complete rectangular render matrix consumed by `NestedTrnTable`. */
export interface TrnGridMatrix {
  rowCount: number;
  columnCount: number;
  /** Emitted cells per row (already excludes cells spanned from above/left). */
  cellsByRow: TrnGridCell[][];
}

// ============================================================================
// HTML RowSpan / ColSpan Matrix Solver
// ============================================================================

/**
 * Computes exact HTML `rowSpan` and `colSpan` placements for every ingredient
 * row and action node in a TRN document.
 *
 * Guarantees:
 *   1. No two action cells ever overlap on the same (row, col) coordinate.
 *   2. Upstream sub-assemblies stretch horizontally (`colSpan > 1`) across any
 *      unused intermediate columns until they meet their downstream merger.
 *   3. Every row spans `columnCount` total column units cleanly with zero gaps.
 *
 * @param doc - Compiled TrnRecipeDocument.
 * @returns Renderable TrnGridMatrix.
 */
export function buildTrnGridMatrix(doc: TrnRecipeDocument): TrnGridMatrix {
  const rowCount = Math.max(1, doc.ingredients.length);

  if (doc.actions.length === 0) {
    return {
      rowCount,
      columnCount: 1,
      cellsByRow: Array.from({ length: rowCount }, (_v, r) => [
        {
          kind: 'passthrough',
          key: `empty-${r}-0`,
          rowSpan: 1,
          colSpan: 1,
          colStart: 0,
        },
      ]),
    };
  }

  // Step 1: Normalize node ranges and resolve any inline-edit collisions
  const sortedActions = [...doc.actions]
    .map((node) => ({
      ...node,
      startRow: Math.max(0, Math.min(rowCount - 1, node.startRow)),
      endRow: Math.max(
        Math.max(0, Math.min(rowCount - 1, node.startRow)),
        Math.min(rowCount - 1, node.endRow)
      ),
      columnDepth: Math.max(0, node.columnDepth),
    }))
    .sort((a, b) =>
      a.columnDepth !== b.columnDepth
        ? a.columnDepth - b.columnDepth
        : a.startRow - b.startRow
    );

  // Track placed cells using dynamic occupancy rows
  const occupancy: boolean[][] = Array.from({ length: rowCount }, () => []);
  const placedNodes: Array<{
    node: TrnActionNode;
    startRow: number;
    endRow: number;
    colStart: number;
    colSpan: number;
  }> = [];

  const ensureColCapacity = (colIdx: number): void => {
    for (let r = 0; r < rowCount; r += 1) {
      while (occupancy[r].length <= colIdx) {
        occupancy[r].push(false);
      }
    }
  };

  for (const node of sortedActions) {
    let targetCol = node.columnDepth;

    // Bump column rightwards if an existing placement collides on [startRow..endRow]
    while (true) {
      ensureColCapacity(targetCol);
      let hasConflict = false;
      for (let r = node.startRow; r <= node.endRow; r += 1) {
        if (occupancy[r][targetCol]) {
          hasConflict = true;
          break;
        }
      }
      if (!hasConflict) break;
      targetCol += 1;
    }

    for (let r = node.startRow; r <= node.endRow; r += 1) {
      occupancy[r][targetCol] = true;
    }

    placedNodes.push({
      node,
      startRow: node.startRow,
      endRow: node.endRow,
      colStart: targetCol,
      colSpan: 1,
    });
  }

  const columnCount = Math.max(
    1,
    ...placedNodes.map((p) => p.colStart + 1)
  );
  ensureColCapacity(columnCount - 1);

  // Step 2: Expand each action cell rightwards across empty intermediate columns
  // so sub-assemblies rest flush against the downstream node that consumes them.
  for (const placed of placedNodes) {
    let nextCol = placed.colStart + 1;
    while (nextCol < columnCount) {
      let canExpand = true;
      for (let r = placed.startRow; r <= placed.endRow; r += 1) {
        if (occupancy[r][nextCol]) {
          canExpand = false;
          break;
        }
      }
      if (!canExpand) break;
      for (let r = placed.startRow; r <= placed.endRow; r += 1) {
        occupancy[r][nextCol] = true;
      }
      placed.colSpan += 1;
      nextCol += 1;
    }
  }

  // Step 3: Build exact row-by-row HTML <td> list skipping rowspan/colspan shadows
  const originMap = new Map<string, (typeof placedNodes)[number]>();
  for (const placed of placedNodes) {
    originMap.set(`${placed.startRow}:${placed.colStart}`, placed);
  }

  const renderedMask: boolean[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => false)
  );
  const cellsByRow: TrnGridCell[][] = Array.from({ length: rowCount }, () => []);

  for (let r = 0; r < rowCount; r += 1) {
    let c = 0;
    while (c < columnCount) {
      if (renderedMask[r][c]) {
        c += 1;
        continue;
      }

      const placed = originMap.get(`${r}:${c}`);
      if (placed) {
        const rowSpan = placed.endRow - placed.startRow + 1;
        for (let rr = placed.startRow; rr <= placed.endRow; rr += 1) {
          for (let cc = placed.colStart; cc < placed.colStart + placed.colSpan; cc += 1) {
            renderedMask[rr][cc] = true;
          }
        }
        cellsByRow[r].push({
          kind: 'action',
          key: placed.node.id,
          node: placed.node,
          rowSpan,
          colSpan: placed.colSpan,
          colStart: c,
        });
        c += placed.colSpan;
      } else {
        // Horizontal passthrough lane connecting an ingredient row to its entry node
        let span = 1;
        while (
          c + span < columnCount &&
          !occupancy[r][c + span] &&
          !renderedMask[r][c + span]
        ) {
          span += 1;
        }
        for (let cc = c; cc < c + span; cc += 1) {
          renderedMask[r][cc] = true;
        }
        cellsByRow[r].push({
          kind: 'passthrough',
          key: `pass-${r}-${c}`,
          rowSpan: 1,
          colSpan: span,
          colStart: c,
        });
        c += span;
      }
    }
  }

  return {
    rowCount,
    columnCount,
    cellsByRow,
  };
}

// ============================================================================
// Immutable Document Modification Helpers
// ============================================================================

/**
 * Rebuilds the `summaryRows` projection whenever ingredients or actions change.
 */
export function syncSummaryRowsFromDocument(
  doc: TrnRecipeDocument
): TrnStepSummaryRow[] {
  const nodeById = new Map(doc.actions.map((a) => [a.id, a]));
  const ingById = new Map(doc.ingredients.map((i) => [i.id, i]));

  return doc.actions.map((node) => {
    const directIngs = node.ingredientRowIds
      .map((id) => ingById.get(id))
      .filter((i): i is IngredientRow => Boolean(i));

    const upstreamNames = node.inputNodeIds
      .map((id) => nodeById.get(id)?.outputLabel)
      .filter((lbl): lbl is string => Boolean(lbl));

    const ingredientsSummary =
      directIngs.length > 0
        ? directIngs
            .map((i) => [i.rawQuantity, i.unit, i.name].filter(Boolean).join(' '))
            .join('; ')
        : upstreamNames.length > 0
          ? `From: ${upstreamNames.join(' + ')}`
          : 'Prep / Equipment';

    const params = [
      ...(node.hardware || []),
      node.temperature,
      node.duration,
    ].filter(Boolean);

    return {
      id: node.id,
      stepNumber: node.stepNumber,
      ingredientIds: node.ingredientRowIds,
      ingredientsSummary,
      actionText: node.instruction,
      parametersText: params.length > 0 ? params.join(' | ') : '-',
      outputLabel: node.outputLabel,
      completed: node.completed,
    };
  });
}

/**
 * Splits a single IngredientRow into two equal parts directly in the UI and
 * recompiles contiguous TRN action spans cleanly.
 */
export function splitIngredientRowInDoc(
  doc: TrnRecipeDocument,
  ingredientId: string
): TrnRecipeDocument {
  const targetIdx = doc.ingredients.findIndex((row) => row.id === ingredientId);
  if (targetIdx === -1) return doc;

  const target = doc.ingredients[targetIdx];
  const halfQty = target.quantity !== null ? Number((target.quantity / 2).toFixed(4)) : null;
  const halfRaw = halfQty !== null ? String(halfQty) : target.rawQuantity;

  const part1: IngredientRow = {
    ...target,
    id: `${target.id}-a`,
    quantity: halfQty,
    rawQuantity: halfRaw,
    isDividedSplit: true,
    dividedPartLabel: 'Part 1/2',
    prepNote: target.prepNote ? `${target.prepNote}, Part 1/2` : 'Part 1/2',
  };

  const part2Step = Math.min(
    Math.max(0, doc.actions.length - 1),
    target.firstUsedStepIndex + 1
  );
  const part2: IngredientRow = {
    ...target,
    id: `${target.id}-b`,
    quantity: halfQty,
    rawQuantity: halfRaw,
    isDividedSplit: true,
    dividedPartLabel: 'Part 2/2',
    prepNote: target.prepNote ? `${target.prepNote}, Part 2/2` : 'Part 2/2',
    firstUsedStepIndex: part2Step,
  };

  const nextIngredients = [
    ...doc.ingredients.slice(0, targetIdx),
    part1,
    part2,
    ...doc.ingredients.slice(targetIdx + 1),
  ].sort((a, b) => a.firstUsedStepIndex - b.firstUsedStepIndex);

  const instructions = doc.actions.map((a) => a.instruction);
  const { stepParams } = extractHardwareAndTemps(instructions);
  const { actions, summaryRows } = buildContiguousTrnGraph(
    nextIngredients,
    instructions,
    stepParams
  );

  return {
    ...doc,
    ingredients: nextIngredients,
    actions,
    summaryRows,
  };
}

/**
 * Appends a new blank editable IngredientRow pinned to Step 1 and updates the
 * final step bounds to cover it cleanly.
 */
export function addBlankIngredientRow(doc: TrnRecipeDocument): TrnRecipeDocument {
  const newRow: IngredientRow = {
    id: `ing-custom-${Date.now().toString(36)}`,
    quantity: 1,
    rawQuantity: '1',
    unit: 'tbsp',
    name: 'New ingredient',
    prepNote: '',
    firstUsedStepIndex: 0,
    completed: false,
  };

  const nextIngredients = [...doc.ingredients, newRow];
  const instructions = doc.actions.map((a) => a.instruction);
  const { stepParams } = extractHardwareAndTemps(instructions);
  const { actions, summaryRows } = buildContiguousTrnGraph(
    nextIngredients,
    instructions,
    stepParams
  );

  return {
    ...doc,
    ingredients: nextIngredients,
    actions,
    summaryRows,
  };
}

/**
 * Moves an IngredientRow up or down by one slot and keeps action node spans
 * covering all rows cleanly.
 */
export function moveIngredientRowInDoc(
  doc: TrnRecipeDocument,
  ingredientId: string,
  direction: -1 | 1
): TrnRecipeDocument {
  const idx = doc.ingredients.findIndex((i) => i.id === ingredientId);
  const swapIdx = idx + direction;
  if (idx === -1 || swapIdx < 0 || swapIdx >= doc.ingredients.length) {
    return doc;
  }

  const nextIngredients = [...doc.ingredients];
  const temp = nextIngredients[idx];
  nextIngredients[idx] = nextIngredients[swapIdx];
  nextIngredients[swapIdx] = temp;

  // Swap their firstUsedStepIndex if needed so order stays intuitive
  const instructions = doc.actions.map((a) => a.instruction);
  const { stepParams } = extractHardwareAndTemps(instructions);
  const { actions, summaryRows } = buildContiguousTrnGraph(
    nextIngredients,
    instructions,
    stepParams
  );

  return {
    ...doc,
    ingredients: nextIngredients,
    actions,
    summaryRows,
  };
}

/**
 * Removes an IngredientRow and rebuilds the TRN matrix so spans adjust cleanly.
 */
export function removeIngredientRowFromDoc(
  doc: TrnRecipeDocument,
  ingredientId: string
): TrnRecipeDocument {
  if (doc.ingredients.length <= 1) return doc;
  const nextIngredients = doc.ingredients.filter((i) => i.id !== ingredientId);
  const instructions = doc.actions.map((a) => a.instruction);
  const { stepParams } = extractHardwareAndTemps(instructions);
  const { actions, summaryRows } = buildContiguousTrnGraph(
    nextIngredients,
    instructions,
    stepParams
  );

  return {
    ...doc,
    ingredients: nextIngredients,
    actions,
    summaryRows,
  };
}
