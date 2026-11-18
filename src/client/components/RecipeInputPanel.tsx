/**
 * ============================================================================
 * Collapsible Recipe Input Panel Component (Retro-Modern)
 * ----------------------------------------------------------------------------
 * Three-mode importer (URL Fetch, Paste Raw Text, Presets) that collapses into
 * a compact single-line preset switcher when a recipe sheet is active so the
 * TRN table stays front and center.
 * ============================================================================
 */

import React, { useState } from 'react';
import { SAMPLE_RECIPES } from '../utils/sampleRecipes';

export type InputTabMode = 'url' | 'raw' | 'presets';

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
  onLoadPreset: (presetId: string) => void;
}

const PRESET_SHORT_LABELS: Record<string, string> = {
  'brown-butter-cookies': 'Brown Butter Cookies',
  'pan-seared-ribeye': 'Cast-Iron Ribeye',
  'buttermilk-pancakes': 'Buttermilk Pancakes',
};

/**
 * Clean collapsible acquisition panel with segmented tab switching.
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
  onLoadPreset,
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
      <section className="retro-window no-print" aria-label="Quick Recipe Switcher">
        <div className="collapsed-import-bar">
          <button
            type="button"
            className="retro-btn primary"
            onClick={onExpand}
          >
            Paste Recipe URL or Text
          </button>

          <div className="collapsed-presets">
            <span className="spec-strip-label">Samples:</span>
            {SAMPLE_RECIPES.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="preset-pill"
                onClick={() => onLoadPreset(preset.id)}
              >
                {PRESET_SHORT_LABELS[preset.id] || preset.label}
              </button>
            ))}
          </div>
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
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'presets'}
            className={`seg-btn ${activeTab === 'presets' ? 'active' : ''}`}
            onClick={() => setActiveTab('presets')}
          >
            Samples
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
                placeholder="https://example.com/recipes/brown-butter-cookies"
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
                {loading ? 'Compiling...' : 'Convert to TRN'}
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
              placeholder={`Paste recipe title, ingredients, and steps here...\n\nExample:\nSkillet Garlic Butter Steak\nYield: 2 servings\nIngredients:\n- 1 lb ribeye steak\n- 4 tbsp butter, divided\nInstructions:\n1. Sear steak in 2 tbsp butter at 450°F until 130°F internal.\n2. Finish with remaining butter.`}
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

        {activeTab === 'presets' && (
          <div className="preset-grid">
            {SAMPLE_RECIPES.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="preset-card"
                onClick={() => onLoadPreset(preset.id)}
              >
                <div className="preset-card-title">{preset.label}</div>
                <div className="preset-card-tag">{preset.tag}</div>
              </button>
            ))}
          </div>
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
