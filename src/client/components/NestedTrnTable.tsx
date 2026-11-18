/**
 * ============================================================================
 * Classic Nested TRN Dependency Grid Table Component
 * ----------------------------------------------------------------------------
 * Renders the iconic "Cooking for Engineers" merged-cell dependency matrix:
 *   - Left columns: Row Tools (hidden in PDF), Scaled Qty, Unit, Ingredient/Prep
 *   - Right columns: Topological merged `rowSpan` / `colSpan` operation cells
 *     computed by `buildTrnGridMatrix(doc)`.
 *   - Inline `contenteditable` editing across ingredient names, prep notes,
 *     instructions, and sub-assembly labels.
 *   - Kitchen Bench Mode click-to-complete step & ingredient dimming.
 * ============================================================================
 */

import React, { useMemo } from 'react';
import type { TrnRecipeDocument, UnitSystem } from '../../shared/types';
import { buildTrnGridMatrix } from '../utils/trnMatrix';
import {
  convertIngredientUnit,
  convertInlineTemperatures,
} from '../utils/unitConverter';

interface NestedTrnTableProps {
  document: TrnRecipeDocument;
  scaleFactor: number;
  unitSystem: UnitSystem;
  benchMode: boolean;
  onUpdateIngredientField: (
    ingredientId: string,
    field: 'name' | 'prepNote',
    value: string
  ) => void;
  onUpdateActionField: (
    actionId: string,
    field: 'instruction' | 'outputLabel',
    value: string
  ) => void;
  onSplitIngredient: (ingredientId: string) => void;
  onMoveIngredient: (ingredientId: string, direction: -1 | 1) => void;
  onRemoveIngredient: (ingredientId: string) => void;
  onToggleIngredientDone: (ingredientId: string) => void;
  onToggleActionDone: (actionId: string) => void;
}

/**
 * Renders the merged-cell Tabular Recipe Notation (TRN) engineering table.
 */
export const NestedTrnTable: React.FC<NestedTrnTableProps> = ({
  document: doc,
  scaleFactor,
  unitSystem,
  benchMode,
  onUpdateIngredientField,
  onUpdateActionField,
  onSplitIngredient,
  onMoveIngredient,
  onRemoveIngredient,
  onToggleIngredientDone,
  onToggleActionDone,
}) => {
  const matrix = useMemo(() => buildTrnGridMatrix(doc), [doc]);

  return (
    <div className="trn-table-scroll">
      <table className="trn-table" aria-label="Nested Tabular Recipe Notation Matrix">
        <thead>
          <tr>
            <th className="trn-row-tools-col no-export">ROW OPS</th>
            <th style={{ textAlign: 'right' }}>QTY</th>
            <th>UNIT</th>
            <th>INGREDIENT / PREP SPEC</th>
            {Array.from({ length: matrix.columnCount }, (_v, cIdx) => (
              <th key={cIdx}>STAGE {cIdx + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doc.ingredients.map((row, rowIndex) => {
            const { displayQty, displayUnit } = convertIngredientUnit(
              row,
              scaleFactor,
              unitSystem
            );
            const rowCells = matrix.cellsByRow[rowIndex] || [];

            return (
              <tr
                key={row.id}
                className={row.completed ? 'trn-row-done' : ''}
              >
                <td className="trn-row-tools-col no-export">
                  <button
                    type="button"
                    className="retro-btn-mini"
                    onClick={() => onMoveIngredient(row.id, -1)}
                    disabled={rowIndex === 0}
                    title="Move row up"
                  >
                    ↑
                  </button>{' '}
                  <button
                    type="button"
                    className="retro-btn-mini"
                    onClick={() => onMoveIngredient(row.id, 1)}
                    disabled={rowIndex === doc.ingredients.length - 1}
                    title="Move row down"
                  >
                    ↓
                  </button>{' '}
                  <button
                    type="button"
                    className="retro-btn-mini"
                    onClick={() => onSplitIngredient(row.id)}
                    title="Split into two divided rows"
                  >
                    ÷2
                  </button>{' '}
                  <button
                    type="button"
                    className="retro-btn-mini"
                    onClick={() => onRemoveIngredient(row.id)}
                    disabled={doc.ingredients.length <= 1}
                    title="Remove row"
                  >
                    ×
                  </button>
                </td>

                <td
                  className={`trn-qty-cell ${benchMode ? 'bench-clickable' : ''}`}
                  onClick={benchMode ? () => onToggleIngredientDone(row.id) : undefined}
                  title={benchMode ? 'Click to mark ingredient prepped' : undefined}
                >
                  {displayQty}
                </td>

                <td
                  className={`trn-unit-cell ${benchMode ? 'bench-clickable' : ''}`}
                  onClick={benchMode ? () => onToggleIngredientDone(row.id) : undefined}
                >
                  {displayUnit}
                </td>

                <td
                  className={`trn-ing-cell ${benchMode ? 'bench-clickable' : ''}`}
                  onClick={benchMode ? () => onToggleIngredientDone(row.id) : undefined}
                >
                  {row.completed && <span className="done-stamp" style={{ marginRight: 5 }}>DONE</span>}
                  <span
                    className="trn-ing-name"
                    contentEditable={!benchMode}
                    suppressContentEditableWarning
                    onClick={(e) => {
                      if (!benchMode) e.stopPropagation();
                    }}
                    onBlur={(e) => {
                      const val = e.currentTarget.textContent?.trim();
                      if (val && val !== row.name) {
                        onUpdateIngredientField(row.id, 'name', val);
                      }
                    }}
                  >
                    {row.name}
                  </span>
                  {(row.prepNote || !benchMode) && (
                    <span
                      className="trn-prep-note"
                      contentEditable={!benchMode}
                      suppressContentEditableWarning
                      onClick={(e) => {
                        if (!benchMode) e.stopPropagation();
                      }}
                      onBlur={(e) => {
                        const rawText = e.currentTarget.textContent?.trim() || '';
                        const cleaned = rawText.replace(/^,\s*/, '');
                        if (cleaned !== row.prepNote) {
                          onUpdateIngredientField(row.id, 'prepNote', cleaned);
                        }
                      }}
                    >
                      {row.prepNote ? `, ${row.prepNote}` : ''}
                    </span>
                  )}
                  {row.isDividedSplit && (
                    <span className="divided-badge">
                      SPLIT{row.dividedPartLabel ? `: ${row.dividedPartLabel}` : ''}
                    </span>
                  )}
                </td>

                {rowCells.map((cell) => {
                  if (cell.kind === 'passthrough') {
                    return (
                      <td
                        key={cell.key}
                        rowSpan={cell.rowSpan}
                        colSpan={cell.colSpan}
                        className="trn-passthrough-cell"
                        title="Ingredient enters downstream"
                      >
                        ───▶
                      </td>
                    );
                  }

                  const { node } = cell;
                  const isFinal =
                    node.stepNumber === doc.actions.length ||
                    node.outputLabel === 'FINISHED DISH';
                  const convertedInstruction = convertInlineTemperatures(
                    node.instruction,
                    unitSystem
                  );
                  const convertedTemp = node.temperature
                    ? convertInlineTemperatures(node.temperature, unitSystem)
                    : undefined;

                  return (
                    <td
                      key={cell.key}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.colSpan}
                      className={`trn-action-cell ${isFinal ? 'final-node' : ''} ${
                        node.completed ? 'trn-cell-done' : ''
                      } ${benchMode ? 'bench-clickable' : ''}`}
                      onClick={benchMode ? () => onToggleActionDone(node.id) : undefined}
                      title={
                        benchMode
                          ? 'Click to toggle step completion'
                          : 'Click text to edit inline before PDF export'
                      }
                    >
                      <div className="trn-action-header">
                        <span className="trn-verb-badge">{node.verb}</span>
                        <span className="trn-step-badge">
                          {node.completed ? (
                            <span className="done-stamp">DONE</span>
                          ) : (
                            `STEP ${node.stepNumber}`
                          )}
                        </span>
                      </div>

                      <div
                        className="trn-action-text"
                        contentEditable={!benchMode}
                        suppressContentEditableWarning
                        onClick={(e) => {
                          if (!benchMode) e.stopPropagation();
                        }}
                        onBlur={(e) => {
                          const val = e.currentTarget.textContent?.trim();
                          if (val && val !== convertedInstruction) {
                            onUpdateActionField(node.id, 'instruction', val);
                          }
                        }}
                      >
                        {convertedInstruction}
                      </div>

                      {(convertedTemp || node.duration || (node.hardware && node.hardware.length > 0)) && (
                        <div className="trn-action-params">
                          {convertedTemp && (
                            <span className="param-pill temp">{convertedTemp}</span>
                          )}
                          {node.duration && (
                            <span className="param-pill">{node.duration}</span>
                          )}
                          {node.hardware?.map((hw) => (
                            <span key={hw} className="param-pill">
                              {hw}
                            </span>
                          ))}
                        </div>
                      )}

                      <div
                        className="trn-output-tag"
                        contentEditable={!benchMode}
                        suppressContentEditableWarning
                        onClick={(e) => {
                          if (!benchMode) e.stopPropagation();
                        }}
                        onBlur={(e) => {
                          const val = e.currentTarget.textContent?.replace(/^⇒\s*/, '').trim();
                          if (val && val !== node.outputLabel) {
                            onUpdateActionField(node.id, 'outputLabel', val);
                          }
                        }}
                      >
                        ⇒ {node.outputLabel}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
