/**
 * ============================================================================
 * Row-per-Step Engineering Summary Table Component
 * ----------------------------------------------------------------------------
 * Alternate TRN presentation rendering a linear bill-of-operations table:
 *   STEP # | INPUT INGREDIENTS (LIVE SCALED) | OPERATION | PARAMETERS | OUTPUT
 *
 * Inline `contenteditable` edits propagate directly into the underlying
 * TrnRecipeDocument so switching back to Nested TRN Grid retains all changes.
 * ============================================================================
 */

import React from 'react';
import type { TrnRecipeDocument, UnitSystem } from '../../shared/types';
import {
  convertIngredientUnit,
  convertInlineTemperatures,
} from '../utils/unitConverter';

interface StepSummaryTableProps {
  document: TrnRecipeDocument;
  scaleFactor: number;
  unitSystem: UnitSystem;
  benchMode: boolean;
  onUpdateActionField: (
    actionId: string,
    field: 'instruction' | 'outputLabel',
    value: string
  ) => void;
  onUpdateSummaryParams: (summaryId: string, value: string) => void;
  onToggleActionDone: (actionId: string) => void;
}

/**
 * Renders the Row-per-Step Engineering Summary Table view.
 */
export const StepSummaryTable: React.FC<StepSummaryTableProps> = ({
  document: doc,
  scaleFactor,
  unitSystem,
  benchMode,
  onUpdateActionField,
  onUpdateSummaryParams,
  onToggleActionDone,
}) => {
  const ingMap = new Map(doc.ingredients.map((i) => [i.id, i]));

  return (
    <div className="trn-table-scroll">
      <table className="trn-table" aria-label="Row-per-Step Engineering Summary Table">
        <thead>
          <tr>
            <th style={{ width: 64, textAlign: 'center' }}>STEP</th>
            <th style={{ minWidth: 210 }}>INPUT INGREDIENTS / SUB-ASSEMBLIES</th>
            <th style={{ minWidth: 280 }}>PROCESS OPERATION</th>
            <th style={{ minWidth: 165 }}>PARAMETERS (HARDWARE / TEMP / TIME)</th>
            <th style={{ minWidth: 135 }}>OUTPUT ASSEMBLY</th>
          </tr>
        </thead>
        <tbody>
          {doc.summaryRows.map((row) => {
            const directIngs = row.ingredientIds
              .map((id) => ingMap.get(id))
              .filter((ing): ing is NonNullable<typeof ing> => Boolean(ing));

            const liveIngredientsText =
              directIngs.length > 0
                ? directIngs
                    .map((ing) => {
                      const { displayQty, displayUnit } = convertIngredientUnit(
                        ing,
                        scaleFactor,
                        unitSystem
                      );
                      return [
                        displayQty !== '-' ? displayQty : '',
                        displayUnit,
                        ing.name,
                        ing.prepNote ? `(${ing.prepNote})` : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                    })
                    .join(' + ')
                : row.ingredientsSummary;

            const convertedAction = convertInlineTemperatures(
              row.actionText,
              unitSystem
            );
            const convertedParams = convertInlineTemperatures(
              row.parametersText,
              unitSystem
            );

            return (
              <tr
                key={row.id}
                className={`${row.completed ? 'trn-cell-done' : ''} ${
                  benchMode ? 'bench-clickable' : ''
                }`}
                onClick={benchMode ? () => onToggleActionDone(row.id) : undefined}
              >
                <td
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    textAlign: 'center',
                    background: 'var(--bg-subtle)',
                  }}
                >
                  {row.completed ? (
                    <span className="done-stamp">DONE</span>
                  ) : (
                    `#${row.stepNumber}`
                  )}
                </td>

                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                  {liveIngredientsText}
                </td>

                <td
                  contentEditable={!benchMode}
                  suppressContentEditableWarning
                  onClick={(e) => {
                    if (!benchMode) e.stopPropagation();
                  }}
                  onBlur={(e) => {
                    const val = e.currentTarget.textContent?.trim();
                    if (val && val !== convertedAction) {
                      onUpdateActionField(row.id, 'instruction', val);
                    }
                  }}
                >
                  {convertedAction}
                </td>

                <td
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}
                  contentEditable={!benchMode}
                  suppressContentEditableWarning
                  onClick={(e) => {
                    if (!benchMode) e.stopPropagation();
                  }}
                  onBlur={(e) => {
                    const val = e.currentTarget.textContent?.trim();
                    if (val && val !== convertedParams) {
                      onUpdateSummaryParams(row.id, val);
                    }
                  }}
                >
                  {convertedParams}
                </td>

                <td
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    color: 'var(--ink-primary)',
                    background: 'var(--bg-accent-soft)',
                  }}
                  contentEditable={!benchMode}
                  suppressContentEditableWarning
                  onClick={(e) => {
                    if (!benchMode) e.stopPropagation();
                  }}
                  onBlur={(e) => {
                    const val = e.currentTarget.textContent?.trim();
                    if (val && val !== row.outputLabel) {
                      onUpdateActionField(row.id, 'outputLabel', val);
                    }
                  }}
                >
                  {row.outputLabel}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
