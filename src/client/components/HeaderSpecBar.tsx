/**
 * ============================================================================
 * Header Bar Component (Retro-Modern)
 * ----------------------------------------------------------------------------
 * Minimalist single-line workstation header displaying the TRN monogram,
 * live `window.api.appVersion` pill, edge capability indicator, and quick
 * importer toggle.
 * ============================================================================
 */

import React from 'react';
import { APP_VERSION } from '../../shared/version';

interface HeaderSpecBarProps {
  hasDocument: boolean;
  inputCollapsed: boolean;
  edgeCapabilities: { ai: boolean; kv: boolean };
  onToggleInputPanel: () => void;
}

/**
 * Renders the simplified retro-modern top header bar.
 */
export const HeaderSpecBar: React.FC<HeaderSpecBarProps> = ({
  hasDocument,
  inputCollapsed,
  edgeCapabilities,
  onToggleInputPanel,
}) => {
  const version =
    typeof window !== 'undefined' && window.api?.appVersion
      ? window.api.appVersion
      : APP_VERSION;

  const isEdgeConnected = edgeCapabilities.ai || edgeCapabilities.kv;

  return (
    <header className="app-header-bar no-print">
      <div className="header-brand">
        <span className="retro-logo-mark">TRN</span>
        <div>
          <span className="header-title">UnfluffRecipes</span>
        </div>
      </div>

      <div className="header-meta">
        <span className="version-badge" title="Build version from window.api.appVersion">
          v{version}
        </span>
        <span
          className="status-dot-pill"
          title={`Workers AI: ${edgeCapabilities.ai ? 'bound' : 'fallback'} | KV: ${edgeCapabilities.kv ? 'bound' : 'signed-token'}`}
        >
          <span className={`status-dot ${isEdgeConnected ? '' : 'local'}`} />
          {edgeCapabilities.ai ? 'Edge + AI' : 'Heuristic'}
        </span>
        {hasDocument && (
          <button
            type="button"
            className="retro-btn subtle"
            onClick={onToggleInputPanel}
          >
            {inputCollapsed ? '+ Import Recipe' : 'Hide Importer'}
          </button>
        )}
      </div>
    </header>
  );
};
