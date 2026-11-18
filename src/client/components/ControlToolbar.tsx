/**
 * ============================================================================
 * Engineering Control Toolbar Component
 * ----------------------------------------------------------------------------
 * Houses all interactive transformations for an active TRN specification:
 *   - View Toggle: Nested TRN Dependency Grid <-> Row-per-Step Summary Table
 *   - Batch Scaling: 0.5x, 1x, 2x, 3x, or custom multiplier
 *   - Unit Conversion: Original, Metric (g/mL/°C), US Imperial (oz/cups/°F)
 *   - Kitchen Bench Mode: Screen Wake Lock + tap-to-checkoff dimming
 *   - Row Tools: + Add Ingredient Row, Reset Edits
 *   - Shareable Link: 14-day expiring permalink generator + copy bar
 *   - Export: One-click Client-Side PDF Download & Print Blueprint
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
 * Renders the multi-group engineering toolbar above the blueprint sheet.
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
        {/* View Mode Toggle */}
        <div className="toolbar-group">
          <span className="toolbar-label">View:</span>
          <button
            type="button"
            className={`retro-btn ${viewMode === 'nested' ? 'active' : ''}`}
            onClick={() => onChangeViewMode('nested')}
          >
            Nested TRN Grid
          </button>
          <button
            type="button"
            className={`retro-btn ${viewMode === 'summary' ? 'active' : ''}`}
            onClick={() => onChangeViewMode('summary')}
          >
            Step Summary Table
          </button>
        </div>

        {/* Batch Scaling */}
        <div className="toolbar-group">
          <span className="toolbar-label">Scale:</span>
          {[0.5, 1, 2, 3].map((mult) => (
            <button
              key={mult}
              type="button"
              className={`retro-btn ${Math.abs(scaleFactor - mult) < 0.001 ? 'active' : ''}`}
              onClick={() => onChangeScaleFactor(mult)}
            >
              {mult}x
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

        {/* Unit System Toggle */}
        <div className="toolbar-group">
          <span className="toolbar-label">Units:</span>
          <button
            type="button"
            className={`retro-btn ${unitSystem === 'original' ? 'active' : ''}`}
            onClick={() => onChangeUnitSystem('original')}
          >
            Original
          </button>
          <button
            type="button"
            className={`retro-btn ${unitSystem === 'metric' ? 'active' : ''}`}
            onClick={() => onChangeUnitSystem('metric')}
          >
            Metric (g/mL/°C)
          </button>
          <button
            type="button"
            className={`retro-btn ${unitSystem === 'imperial' ? 'active' : ''}`}
            onClick={() => onChangeUnitSystem('imperial')}
          >
            US Imperial (°F)
          </button>
        </div>

        {/* Interactive Mode, Share & PDF Export */}
        <div className="toolbar-group">
          <button
            type="button"
            className={`retro-btn ${benchMode ? 'bench-on' : ''}`}
            onClick={onToggleBenchMode}
            title="Keep screen awake and click cells to check off completed steps"
          >
            Kitchen Bench: {benchMode ? 'ON' : 'OFF'}
            {benchMode && wakeLockStatus === 'active' ? ' [WAKE LOCKED]' : ''}
          </button>
          <button
            type="button"
            className="retro-btn"
            onClick={onOpenAddRowModal}
          >
            + Row
          </button>
          <button
            type="button"
            className="retro-btn"
            onClick={onResetEdits}
            title="Restore original compiled recipe"
          >
            Reset
          </button>
          <button
            type="button"
            className="retro-btn"
            onClick={onShareRecipe}
            disabled={sharingInProgress}
          >
            {sharingInProgress ? 'SAVING...' : 'Share (14d Link)'}
          </button>
          <button
            type="button"
            className="retro-btn primary"
            onClick={onDownloadPdf}
            disabled={exportingPdf}
          >
            {exportingPdf ? 'RENDERING PDF...' : 'Save PDF'}
          </button>
          <button
            type="button"
            className="retro-btn"
            onClick={onPrintBlueprint}
          >
            Print
          </button>
        </div>
      </div>

      {shareUrl && (
        <div className="share-banner">
          <strong>[14-DAY PERMALINK]</strong>
          <input
            type="text"
            readOnly
            className="share-url-input"
            value={shareUrl}
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className="retro-btn" onClick={handleCopyShareUrl}>
            {copied ? 'Copied!' : 'Copy URL'}
          </button>
          {shareExpiresAt && (
            <span>
              Auto-expires: <strong>{new Date(shareExpiresAt).toLocaleString()}</strong> (14 days max)
            </span>
          )}
        </div>
      )}
    </section>
  );
};
