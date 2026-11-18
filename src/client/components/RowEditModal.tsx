/**
 * ============================================================================
 * Ingredient Row Insertion Modal Component
 * ----------------------------------------------------------------------------
 * Allows users to append a structured ingredient row pinned to any specific
 * step index in the TRN table prior to exporting to PDF or sharing.
 * ============================================================================
 */

import React, { useState } from 'react';
import type { IngredientRow, TrnActionNode } from '../../shared/types';
import { parseNumericToken } from '../../worker/heuristicParser';

interface RowEditModalProps {
  isOpen: boolean;
  actions: TrnActionNode[];
  onClose: () => void;
  onAddIngredient: (row: IngredientRow) => void;
}

/**
 * Retro bevelled dialog for adding a custom ingredient row bound to a TRN step.
 */
export const RowEditModal: React.FC<RowEditModalProps> = ({
  isOpen,
  actions,
  onClose,
  onAddIngredient,
}) => {
  const [rawQty, setRawQty] = useState('1');
  const [unit, setUnit] = useState('tbsp');
  const [name, setName] = useState('');
  const [prepNote, setPrepNote] = useState('');
  const [stepIndex, setStepIndex] = useState(0);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const parsedQty = parseNumericToken(rawQty);
    onAddIngredient({
      id: `ing-user-${Date.now().toString(36)}`,
      quantity: parsedQty,
      rawQuantity: rawQty.trim() || '-',
      unit: unit.trim(),
      name: name.trim(),
      prepNote: prepNote.trim(),
      firstUsedStepIndex: stepIndex,
      completed: false,
    });

    setName('');
    setPrepNote('');
    onClose();
  };

  return (
    <div className="retro-modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="Add Ingredient Row">
      <div className="retro-window retro-modal">
        <div className="retro-titlebar">
          <span className="retro-title-text">INSERT INGREDIENT ROW</span>
          <button type="button" className="retro-btn-mini" onClick={onClose}>
            ×
          </button>
        </div>

        <form className="retro-panel-body" onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="modal-field">
              <label htmlFor="modal-qty">QUANTITY</label>
              <input
                id="modal-qty"
                className="retro-input"
                value={rawQty}
                onChange={(e) => setRawQty(e.target.value)}
                placeholder="e.g. 1 1/2"
              />
            </div>

            <div className="modal-field">
              <label htmlFor="modal-unit">UNIT</label>
              <input
                id="modal-unit"
                className="retro-input"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="cup, tbsp, g..."
              />
            </div>
          </div>

          <div className="modal-field">
            <label htmlFor="modal-name">INGREDIENT NAME</label>
            <input
              id="modal-name"
              className="retro-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. flaky sea salt"
              required
            />
          </div>

          <div className="modal-field">
            <label htmlFor="modal-prep">PREP NOTE (OPTIONAL)</label>
            <input
              id="modal-prep"
              className="retro-input"
              value={prepNote}
              onChange={(e) => setPrepNote(e.target.value)}
              placeholder="e.g. finely chopped"
            />
          </div>

          <div className="modal-field">
            <label htmlFor="modal-step">ENTERS AT STEP</label>
            <select
              id="modal-step"
              className="retro-select"
              value={stepIndex}
              onChange={(e) => setStepIndex(Number(e.target.value))}
            >
              {actions.map((act, idx) => (
                <option key={act.id} value={idx}>
                  Step {act.stepNumber}: {act.verb} — {act.outputLabel}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button type="button" className="retro-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="retro-btn primary">
              Insert Row
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
