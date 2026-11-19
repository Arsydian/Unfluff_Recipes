/**
 * ============================================================================
 * Streamlined Specification Header Block Component (Retro-Modern)
 * ----------------------------------------------------------------------------
 * Clean two-tier technical manual header:
 *   - Top tier: Editable recipe title & description alongside a compact KPI
 *     strip (Yield, Prep, Cook, Total, Doc ID).
 *   - Bottom tier: Equipment chips (with toggleable `+` adder), live-converted
 *     target temperatures, and safe HTTP(S) source link.
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
 * Formats scaled yield cleanly (e.g., "24 cookies" * 2 -> "48 cookies (2x)").
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
  return `${scaledCount} ${unitPart} (${scaleFactor}×)`;
}

/**
 * Extracts a compact hostname label for displaying the source URL cleanly.
 */
function formatSourceHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, '');
  } catch {
    return rawUrl;
  }
}

/**
 * Renders the uncluttered retro-modern specification header above the TRN grid.
 */
export const SpecHeaderBlock: React.FC<SpecHeaderBlockProps> = ({
  document: doc,
  scaleFactor,
  unitSystem,
  onUpdateTitle,
  onAddHardware,
  onRemoveHardware,
}) => {
  const [addingHw, setAddingHw] = useState(false);
  const [newHw, setNewHw] = useState('');

  const handleAddHw = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHw.trim()) return;
    onAddHardware(newHw.trim());
    setNewHw('');
    setAddingHw(false);
  };

  const { metadata } = doc;
  const convertedTemps = metadata.criticalTemperatures.map((temp) =>
    convertInlineTemperatures(temp, unitSystem)
  );

  return (
    <header className="spec-header" aria-label="Recipe Engineering Spec Header">
      <div className="spec-header-top">
        <div className="spec-title-col">
          <h1
            className="spec-recipe-title"
            contentEditable
            suppressContentEditableWarning
            title="Click to edit recipe title"
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
        </div>

        <div className="spec-kpi-grid">
          <div className="spec-kpi-item">
            <span className="spec-kpi-label">YIELD</span>
            <span className="spec-kpi-value">
              {formatScaledYield(metadata.baseServings, metadata.yieldLabel, scaleFactor)}
            </span>
          </div>
          {metadata.prepTime && (
            <div className="spec-kpi-item">
              <span className="spec-kpi-label">PREP</span>
              <span className="spec-kpi-value">{metadata.prepTime}</span>
            </div>
          )}
          {metadata.cookTime && (
            <div className="spec-kpi-item">
              <span className="spec-kpi-label">COOK</span>
              <span className="spec-kpi-value">{metadata.cookTime}</span>
            </div>
          )}
          {metadata.totalTime && (
            <div className="spec-kpi-item">
              <span className="spec-kpi-label">TOTAL</span>
              <span className="spec-kpi-value">{metadata.totalTime}</span>
            </div>
          )}
          <div className="spec-kpi-item">
            <span className="spec-kpi-label">SPEC ID</span>
            <span className="spec-kpi-value">{metadata.docNumber}</span>
          </div>
          <div className="spec-kpi-item">
            <span className="spec-kpi-label">COMPILER</span>
            <span className="spec-kpi-value">
              {metadata.parserEngine === 'workers-ai'
                ? 'WORKERS AI'
                : metadata.parserEngine === 'hybrid'
                  ? 'HYBRID AI'
                  : 'HEURISTIC'}
            </span>
          </div>
        </div>
      </div>

      <div className="spec-meta-strip">
        <div className="spec-chip-list">
          <span className="spec-strip-label">Equipment:</span>
          {metadata.hardware.map((hw) => (
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
          ))}
          {addingHw ? (
            <form
              onSubmit={handleAddHw}
              className="no-export"
              style={{ display: 'inline-flex', gap: 4 }}
            >
              <input
                type="text"
                autoFocus
                value={newHw}
                onChange={(e) => setNewHw(e.target.value)}
                onBlur={() => {
                  if (!newHw.trim()) setAddingHw(false);
                }}
                placeholder="Tool name"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  padding: '2px 6px',
                  width: 110,
                  border: '1px solid var(--border-ink)',
                  borderRadius: 3,
                }}
              />
              <button type="submit" className="retro-btn-mini">
                Add
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="retro-btn-mini no-export"
              onClick={() => setAddingHw(true)}
              title="Add cookware or tool"
            >
              +
            </button>
          )}

          {convertedTemps.length > 0 && (
            <>
              <span className="spec-strip-label" style={{ marginLeft: 8 }}>
                Temps:
              </span>
              {convertedTemps.map((t, idx) => (
                <span key={`${t}-${idx}`} className="spec-chip temp">
                  {t}
                </span>
              ))}
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {metadata.expiresAt && (
            <span className="spec-strip-label">
              Expires {new Date(metadata.expiresAt).toLocaleDateString()}
            </span>
          )}
          {metadata.sourceUrl && /^https?:\/\//i.test(metadata.sourceUrl) && (
            <a
              href={metadata.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="spec-source-link"
              title={metadata.sourceUrl}
            >
              Source: {formatSourceHost(metadata.sourceUrl)} ↗
            </a>
          )}
        </div>
      </div>
    </header>
  );
};
