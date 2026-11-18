/**
 * ============================================================================
 * Collapsible Recipe Input Panel Component (Retro-Modern)
 * ----------------------------------------------------------------------------
 * Two-mode recipe importer (Recipe URL fetch & Paste Text) that collapses into
 * a clean single-line action bar once a recipe sheet is active.
 * ============================================================================
 */

import React, { useState } from 'react';

export type InputTabMode = 'url' | 'raw';

interface RecipeInputPanelProps {
  loading: boolean;
  hasDocument: boolean;
  isCollapsed: boolean;
  errorMessage: string | null;
  warnings: string[];
  onExpand: () => void;
  onCollapse: () => void;
  onParseUrl: (url: string, preferAi: boolean) => Promise<void>;
  onParseRawText: (rawText: string, preferAi: boolean) => Promise<void>;
}

/**
 * Clean collapsible recipe acquisition panel with segmented URL / Paste Text tabs.
 */
export const RecipeInputPanel: React.FC<RecipeInputPanelProps> = ({
  loading,
  hasDocument,
  isCollapsed,
  errorMessage,
  warnings,
  onExpand,
  onCollapse,
  onParseUrl,
  onParseRawText,
}) => {
  const [activeTab, setActiveTab] = useState<InputTabMode>('url');
  const [urlInput, setUrlInput] = useState('');
  const [rawTextInput, setRawTextInput] = useState('');
  const [preferAi, setPreferAi] = useState(false);

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || loading) return;
    await onParseUrl(urlInput.trim(), preferAi);
  };

  const handleRawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawTextInput.trim() || loading) return;
    await onParseRawText(rawTextInput.trim(), preferAi);
  };

  if (isCollapsed && hasDocument && !errorMessage) {
    return (
      <section className="retro-window no-print" aria-label="Quick Recipe Importer">
        <div className="collapsed-import-bar">
          <button
            type="button"
            className="retro-btn primary"
            onClick={onExpand}
          >
            Paste Recipe URL or Text
          </button>
          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
            Click any ingredient, instruction, or title below to edit inline before PDF export.
          </span>
        </div>
        {warnings.length > 0 && (
          <div style={{ padding: '0 14px 10px 14px' }}>
            {warnings.map((warn, idx) => (
              <div key={idx} className="notice-bar">
                {warn}
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="retro-window no-print" aria-label="Recipe Input">
      <div className="retro-panel-header">
        <div className="segmented-control" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'url'}
            className={`seg-btn ${activeTab === 'url' ? 'active' : ''}`}
            onClick={() => setActiveTab('url')}
          >
            Recipe URL
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'raw'}
            className={`seg-btn ${activeTab === 'raw' ? 'active' : ''}`}
            onClick={() => setActiveTab('raw')}
          >
            Paste Text
          </button>
        </div>

        {hasDocument && (
          <button
            type="button"
            className="retro-btn subtle"
            onClick={onCollapse}
          >
            Done
          </button>
        )}
      </div>

      <div className="retro-panel-body">
        {activeTab === 'url' && (
          <form onSubmit={handleUrlSubmit}>
            <div className="input-row">
              <input
                type="url"
                className="retro-input"
                placeholder="https://example.com/recipes/..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                required
                aria-label="Recipe URL"
              />
              <button
                type="submit"
                className="retro-btn primary"
                disabled={loading}
              >
                {loading ? 'Compiling...' : 'Unfluff Recipe'}
              </button>
            </div>
            <div className="input-footer-row">
              <span>
                Extracts schema.org recipe data, hardware, temps, and splits divided ingredients.
              </span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={preferAi}
                  onChange={(e) => setPreferAi(e.target.checked)}
                />
                AI Assist (when bound)
              </label>
            </div>
          </form>
        )}

        {activeTab === 'raw' && (
          <form onSubmit={handleRawSubmit}>
            <textarea
              className="retro-textarea"
              placeholder="Paste recipe title, ingredients, and instructions here..."
              value={rawTextInput}
              onChange={(e) => setRawTextInput(e.target.value)}
              required
              aria-label="Raw Recipe Text"
            />
            <div className="input-footer-row">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={preferAi}
                  onChange={(e) => setPreferAi(e.target.checked)}
                />
                AI Assist (when bound)
              </label>
              <button
                type="submit"
                className="retro-btn primary"
                disabled={loading}
              >
                {loading ? 'Parsing...' : 'Compile Text'}
              </button>
            </div>
          </form>
        )}

        {errorMessage && (
          <div className="notice-bar error" role="alert">
            {errorMessage}{' '}
            {activeTab === 'url' && (
              <button
                type="button"
                className="retro-btn-mini"
                onClick={() => setActiveTab('raw')}
                style={{ marginLeft: 8 }}
              >
                Use Paste Text
              </button>
            )}
          </div>
        )}

        {warnings.map((warn, idx) => (
          <div key={idx} className="notice-bar">
            {warn}
          </div>
        ))}
      </div>
    </section>
  );
};
