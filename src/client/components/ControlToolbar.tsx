/**
 * ============================================================================
 * Simplified Two-Zone Control Toolbar (Retro-Modern)
 * ----------------------------------------------------------------------------
 * Left zone: Segmented controls for View Mode, Batch Scale, and Unit System.
 * Right zone: Cook Mode (Wake Lock), + Ingredient, Reset, 14-day Share, PDF.
 * ============================================================================
 */

import React, { useState } from 'react';
import type { TrnViewMode, UnitSystem } from '../../shared/types';

interface ControlToolbarProps {
  viewMode: TrnViewMode;
  onChangeViewMode: (mode: TrnViewMode) => void;
  scaleFactor: number;
  onChangeScaleFactor: (factor: number) => void;
  unitSystem: UnitSystem;
  onChangeUnitSystem: (system: UnitSystem) => void;
  benchMode: boolean;
  wakeLockStatus: 'off' | 'active' | 'unsupported';
  onToggleBenchMode: () => void;
  onOpenAddRowModal: () => void;
  onResetEdits: () => void;
  onShareRecipe: () => Promise<void>;
  sharingInProgress: boolean;
  shareUrl: string | null;
  shareExpiresAt: string | null;
  onDownloadPdf: () => Promise<void>;
  exportingPdf: boolean;
  onPrintBlueprint: () => void;
}

/**
 * Clean segmented toolbar separating recipe transforms from export actions.
 */
export const ControlToolbar: React.FC<ControlToolbarProps> = ({
  viewMode,
  onChangeViewMode,
  scaleFactor,
  onChangeScaleFactor,
  unitSystem,
  onChangeUnitSystem,
  benchMode,
  wakeLockStatus,
  onToggleBenchMode,
  onOpenAddRowModal,
  onResetEdits,
  onShareRecipe,
  sharingInProgress,
  shareUrl,
  shareExpiresAt,
  onDownloadPdf,
  exportingPdf,
  onPrintBlueprint,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="retro-window no-print" aria-label="TRN Controls">
      <div className="toolbar-bar">
        {/* Left Zone: View, Scale & Units */}
        <div className="toolbar-zone">
          <div className="segmented-control" aria-label="Table View">
            <button
              type="button"
              className={`seg-btn ${viewMode === 'nested' ? 'active' : ''}`}
              onClick={() => onChangeViewMode('nested')}
            >
              Flow Grid
            </button>
            <button
              type="button"
              className={`seg-btn ${viewMode === 'summary' ? 'active' : ''}`}
              onClick={() => onChangeViewMode('summary')}
            >
              Step List
            </button>
          </div>

          <div className="segmented-control" aria-label="Batch Scale">
            {[0.5, 1, 2, 3].map((mult) => (
              <button
                key={mult}
                type="button"
                className={`seg-btn ${Math.abs(scaleFactor - mult) < 0.001 ? 'active' : ''}`}
                onClick={() => onChangeScaleFactor(mult)}
              >
                {mult}×
              </button>
            ))}
            <input
              type="number"
              min="0.1"
              max="20"
              step="0.25"
              aria-label="Custom scale multiplier"
              className="scale-custom-input"
              value={scaleFactor}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (Number.isFinite(val) && val > 0) {
                  onChangeScaleFactor(val);
                }
              }}
            />
          </div>

          <div className="segmented-control" aria-label="Unit System">
            <button
              type="button"
              className={`seg-btn ${unitSystem === 'original' ? 'active' : ''}`}
              onClick={() => onChangeUnitSystem('original')}
            >
              Orig
            </button>
            <button
              type="button"
              className={`seg-btn ${unitSystem === 'metric' ? 'active' : ''}`}
              onClick={() => onChangeUnitSystem('metric')}
            >
              Metric
            </button>
            <button
              type="button"
              className={`seg-btn ${unitSystem === 'imperial' ? 'active' : ''}`}
              onClick={() => onChangeUnitSystem('imperial')}
            >
              Imperial
            </button>
          </div>
        </div>

        {/* Right Zone: Interactive Modes & Output */}
        <div className="toolbar-zone">
          <button
            type="button"
            className={`retro-btn ${benchMode ? 'bench-on' : 'subtle'}`}
            onClick={onToggleBenchMode}
            title="Keep screen awake and click cells to check off steps"
          >
            {benchMode && wakeLockStatus === 'active' ? '● ' : ''}
            Cook Mode
          </button>
          <button
            type="button"
            className="retro-btn subtle"
            onClick={onOpenAddRowModal}
          >
            + Ingredient
          </button>
          <button
            type="button"
            className="retro-btn subtle"
            onClick={onResetEdits}
            title="Restore original compiled recipe"
          >
            Reset
          </button>
          <button
            type="button"
            className="retro-btn subtle"
            onClick={onShareRecipe}
            disabled={sharingInProgress}
          >
            {sharingInProgress ? 'Saving...' : 'Share (14d)'}
          </button>
          <button
            type="button"
            className="retro-btn subtle"
            onClick={onPrintBlueprint}
          >
            Print
          </button>
          <button
            type="button"
            className="retro-btn primary"
            onClick={onDownloadPdf}
            disabled={exportingPdf}
          >
            {exportingPdf ? 'Exporting...' : 'Save PDF'}
          </button>
        </div>
      </div>

      {shareUrl && (
        <div className="share-banner">
          <span>14-day link:</span>
          <input
            type="text"
            readOnly
            className="share-url-input"
            value={shareUrl}
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className="retro-btn" onClick={handleCopyShareUrl}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          {shareExpiresAt && (
            <span style={{ color: 'var(--ink-secondary)' }}>
              Expires {new Date(shareExpiresAt).toLocaleDateString()}
            </span>
          )}
        </div>
      )}
    </section>
  );
};
