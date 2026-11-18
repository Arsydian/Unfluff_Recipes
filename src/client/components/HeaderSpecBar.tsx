/**
 * ============================================================================
 * Header Spec Bar Component
 * ----------------------------------------------------------------------------
 * Renders the early-2000s engineering application titlebar with the dynamic
 * build version badge read from `window.api.appVersion`, parser telemetry,
 * and reset navigation.
 * ============================================================================
 */

import React from 'react';
import { APP_CODENAME, APP_VERSION } from '../../shared/version';

interface HeaderSpecBarProps {
  /** Whether an active recipe is loaded on the blueprint canvas. */
  hasDocument: boolean;
  /** Current runtime capabilities fetched from `/api/health`. */
  edgeCapabilities: { ai: boolean; kv: boolean };
  /** Callback to return to a clean workspace. */
  onResetWorkspace: () => void;
}

/**
 * Displays the top workstation titlebar and live `window.api.appVersion` badge.
 */
export const HeaderSpecBar: React.FC<HeaderSpecBarProps> = ({
  hasDocument,
  edgeCapabilities,
  onResetWorkspace,
}) => {
  const version =
    typeof window !== 'undefined' && window.api?.appVersion
      ? window.api.appVersion
      : APP_VERSION;

  return (
    <header className="retro-window no-print">
      <div className="retro-titlebar">
        <div className="retro-titlebar-left">
          <span className="retro-logo-mark">TRN-CAD</span>
          <span className="retro-title-text">
            UNFLUFFRECIPES // TABULAR RECIPE NOTATION COMPILER
          </span>
        </div>
        <div className="retro-titlebar-right">
          <span className="version-badge" title="Build version synchronized via window.api.appVersion">
            v{version} ({APP_CODENAME})
          </span>
          <span className="status-pill">
            AI:{edgeCapabilities.ai ? 'ON' : 'HEURISTIC'} | KV:{edgeCapabilities.kv ? 'ON' : 'TOKEN'}
          </span>
          {hasDocument && (
            <button
              type="button"
              className="retro-btn"
              onClick={onResetWorkspace}
              title="Clear current specification sheet"
            >
              [New Spec]
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
