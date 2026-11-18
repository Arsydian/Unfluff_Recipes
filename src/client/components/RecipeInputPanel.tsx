/**
 * ============================================================================
 * Recipe Input Panel Component
 * ----------------------------------------------------------------------------
 * Three-tab input panel supporting:
 *   1. URL Fetcher (scrapes schema.org/Recipe JSON-LD, Microdata, or HTML)
 *   2. Paste Raw Recipe Text (fallback for blocked/paywalled sites or notes)
 *   3. Reference Presets (one-click offline demo specifications)
 * ============================================================================
 */

import React, { useState } from 'react';
import { SAMPLE_RECIPES } from '../utils/sampleRecipes';

export type InputTabMode = 'url' | 'raw' | 'presets';

interface RecipeInputPanelProps {
  loading: boolean;
  errorMessage: string | null;
  warnings: string[];
  onParseUrl: (url: string, preferAi: boolean) => Promise<void>;
  onParseRawText: (rawText: string, preferAi: boolean) => Promise<void>;
  onLoadPreset: (presetId: string) => void;
}

/**
 * Tabbed recipe acquisition panel styled in early-2000s technical web form chrome.
 */
export const RecipeInputPanel: React.FC<RecipeInputPanelProps> = ({
  loading,
  errorMessage,
  warnings,
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

  return (
    <section className="retro-window no-print" aria-label="Recipe Input">
      <div className="retro-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'url'}
          className={`retro-tab ${activeTab === 'url' ? 'active' : ''}`}
          onClick={() => setActiveTab('url')}
        >
          [1] Fetch Recipe URL
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'raw'}
          className={`retro-tab ${activeTab === 'raw' ? 'active' : ''}`}
          onClick={() => setActiveTab('raw')}
        >
          [2] Paste Raw Recipe Text
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'presets'}
          className={`retro-tab ${activeTab === 'presets' ? 'active' : ''}`}
          onClick={() => setActiveTab('presets')}
        >
          [3] Reference Presets
        </button>
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
                {loading ? 'COMPILING...' : 'UNFLUFF & COMPILE TRN'}
              </button>
            </div>
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                gap: 8,
                fontSize: 11,
                color: '#334155',
              }}
            >
              <span>
                Extracts schema.org/Recipe JSON-LD, Microdata, or semantic HTML; splits divided ingredients automatically.
              </span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={preferAi}
                  onChange={(e) => setPreferAi(e.target.checked)}
                />
                Force Workers AI refinement (when bound)
              </label>
            </div>
          </form>
        )}

        {activeTab === 'raw' && (
          <form onSubmit={handleRawSubmit}>
            <textarea
              className="retro-textarea"
              placeholder={`Paste recipe title, ingredients, and steps here (works for paywalled sites, PDFs, or personal notes)...\n\nExample:\nSkillet Garlic Butter Steak\nYield: 2 servings\nIngredients:\n- 1 lb ribeye steak\n- 4 tbsp butter, divided\nInstructions:\n1. Sear steak in 2 tbsp butter at 450°F until 130°F internal.\n2. Finish with remaining butter.`}
              value={rawTextInput}
              onChange={(e) => setRawTextInput(e.target.value)}
              required
              aria-label="Raw Recipe Text"
            />
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <label style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={preferAi}
                  onChange={(e) => setPreferAi(e.target.checked)}
                />
                Use Workers AI fallback if bound
              </label>
              <button
                type="submit"
                className="retro-btn primary"
                disabled={loading}
              >
                {loading ? 'PARSING...' : 'COMPILE RAW TEXT TO TRN'}
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
            <strong>[ERR]</strong> {errorMessage}{' '}
            {activeTab === 'url' && (
              <button
                type="button"
                className="retro-btn-mini"
                onClick={() => setActiveTab('raw')}
                style={{ marginLeft: 6 }}
              >
                Switch to Raw Text Tab
              </button>
            )}
          </div>
        )}

        {warnings.map((warn, idx) => (
          <div key={idx} className="notice-bar">
            <strong>[WARN]</strong> {warn}
          </div>
        ))}
      </div>
    </section>
  );
};
