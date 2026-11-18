/**
 * ============================================================================
 * CAD Specification Title Block Header Component
 * ----------------------------------------------------------------------------
 * Renders an engineering title block above the TRN matrix containing:
 *   - Editable Recipe Title & Description
 *   - Document ID, Revision, Active Scale Yield, Parser Confidence
 *   - Prep / Cook / Total Duration Breakdown
 *   - Consolidated Cookware / Hardware Checklist (editable tags)
 *   - Critical Target Temperatures (live-converted between °F and °C)
 *   - 14-day Share Retention Status when loaded from a permalink
 * ============================================================================
 */

import React, { useState } from 'react';
import type { TrnRecipeDocument, UnitSystem } from '../../shared/types';
import { convertInlineTemperatures } from '../utils/unitConverter';

interface SpecHeaderBlockProps {
  document: TrnRecipeDocument;
  scaleFactor: number;
  unitSystem: UnitSystem;
  onUpdateTitle: (newTitle: string) => void;
  onAddHardware: (item: string) => void;
  onRemoveHardware: (item: string) => void;
}

/**
 * Formats scaled yield label cleanly (e.g., "24 cookies" * 2 -> "48 cookies (2x)").
 */
function formatScaledYield(
  baseServings: number,
  yieldLabel: string,
  scaleFactor: number
): string {
  if (Math.abs(scaleFactor - 1) < 0.001) {
    return yieldLabel;
  }
  const scaledCount = Number((baseServings * scaleFactor).toFixed(1));
  const unitPart = yieldLabel.replace(/^\d+(?:\.\d+)?\s*/, '').trim() || 'servings';
  return `${scaledCount} ${unitPart} (${scaleFactor}x)`;
}

/**
 * CAD-style header table displaying recipe engineering metadata & mise en place.
 */
export const SpecHeaderBlock: React.FC<SpecHeaderBlockProps> = ({
  document: doc,
  scaleFactor,
  unitSystem,
  onUpdateTitle,
  onAddHardware,
  onRemoveHardware,
}) => {
  const [newHw, setNewHw] = useState('');

  const handleAddHw = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHw.trim()) return;
    onAddHardware(newHw.trim());
    setNewHw('');
  };

  const { metadata } = doc;
  const convertedTemps = metadata.criticalTemperatures.map((temp) =>
    convertInlineTemperatures(temp, unitSystem)
  );

  return (
    <table className="spec-title-block" aria-label="Recipe Engineering Spec Header">
      <tbody>
        <tr>
          <td colSpan={3} className="spec-title-cell">
            <span className="spec-cell-label">SPECIFICATION TITLE (CLICK TO EDIT)</span>
            <h1
              className="spec-recipe-title"
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => {
                const updated = e.currentTarget.textContent?.trim();
                if (updated && updated !== doc.title) {
                  onUpdateTitle(updated);
                }
              }}
            >
              {doc.title}
            </h1>
            {doc.description && (
              <div className="spec-recipe-desc">{doc.description}</div>
            )}
          </td>
          <td>
            <span className="spec-cell-label">DOC NO. / REV</span>
            <div className="spec-mono-value">
              {metadata.docNumber} / {metadata.revision}
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
              Engine: {metadata.parserEngine.toUpperCase()} ({Math.round(metadata.confidenceScore * 100)}%)
            </div>
          </td>
        </tr>

        <tr>
          <td>
            <span className="spec-cell-label">SCALED YIELD</span>
            <div className="spec-mono-value">
              {formatScaledYield(metadata.baseServings, metadata.yieldLabel, scaleFactor)}
            </div>
          </td>
          <td>
            <span className="spec-cell-label">PREP / COOK / TOTAL TIME</span>
            <div className="spec-mono-value">
              {[
                metadata.prepTime ? `Prep: ${metadata.prepTime}` : null,
                metadata.cookTime ? `Cook: ${metadata.cookTime}` : null,
                metadata.totalTime ? `Total: ${metadata.totalTime}` : null,
              ]
                .filter(Boolean)
                .join(' | ') || 'Not specified'}
            </div>
          </td>
          <td>
            <span className="spec-cell-label">CRITICAL TARGET TEMPS</span>
            <div className="spec-chip-list">
              {convertedTemps.length > 0 ? (
                convertedTemps.map((t, idx) => (
                  <span key={`${t}-${idx}`} className="spec-chip temp">
                    {t}
                  </span>
                ))
              ) : (
                <span className="spec-mono-value" style={{ color: '#64748b' }}>
                  Ambient / Stovetop
                </span>
              )}
            </div>
          </td>
          <td>
            <span className="spec-cell-label">RETENTION / SOURCE</span>
            <div className="spec-mono-value" style={{ fontSize: 11 }}>
              {metadata.expiresAt
                ? `Expires: ${new Date(metadata.expiresAt).toLocaleDateString()}`
                : 'Active Draft (14d on share)'}
            </div>
            {metadata.sourceUrl && /^https?:\/\//i.test(metadata.sourceUrl) && (
              <div
                style={{
                  fontSize: 10,
                  maxWidth: 220,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <a
                  href={metadata.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#003366' }}
                >
                  {metadata.sourceUrl}
                </a>
              </div>
            )}
          </td>
        </tr>

        <tr>
          <td colSpan={4}>
            <span className="spec-cell-label">REQUIRED HARDWARE / MISE EN PLACE</span>
            <div className="spec-chip-list">
              {metadata.hardware.length > 0 ? (
                metadata.hardware.map((hw) => (
                  <span key={hw} className="spec-chip">
                    {hw}
                    <button
                      type="button"
                      className="spec-chip-remove no-export"
                      onClick={() => onRemoveHardware(hw)}
                      title={`Remove ${hw}`}
                    >
                      ×
                    </button>
                  </span>
                ))
              ) : (
                <span className="spec-mono-value" style={{ color: '#64748b' }}>
                  Standard kitchen prep tools
                </span>
              )}

              <form
                onSubmit={handleAddHw}
                className="no-export"
                style={{ display: 'inline-flex', gap: 3, marginLeft: 4 }}
              >
                <input
                  type="text"
                  value={newHw}
                  onChange={(e) => setNewHw(e.target.value)}
                  placeholder="+ hardware"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    padding: '1px 5px',
                    width: 96,
                    border: '1px solid #94a3b8',
                  }}
                />
                <button type="submit" className="retro-btn-mini">
                  Add
                </button>
              </form>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
};
