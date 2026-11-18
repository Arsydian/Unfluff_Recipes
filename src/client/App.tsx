/**
 * ============================================================================
 * Main UnfluffRecipes Application Shell
 * ----------------------------------------------------------------------------
 * Orchestrates:
 *   - Shared link loading (`?r=<tokenOrId>` or `/r/<id>`) with 14-day checks
 *   - URL & raw-text recipe compilation (via `/api/parse` with local raw fallback)
 *   - Live batch scaling, Metric/Imperial conversion, and view toggling
 *   - Inline cell editing, divided-row splitting, and custom row insertion
 *   - Kitchen Bench Mode with browser Screen Wake Lock API lifecycle
 *   - 2-week shareable permalink creation & client-side PDF export
 * ============================================================================
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  IngredientRow,
  LoadSharedRecipeResponse,
  ParseRecipeResponse,
  ShareRecipeResponse,
  TrnRecipeDocument,
  TrnViewMode,
  UnitSystem,
} from '../shared/types';
import {
  buildContiguousTrnGraph,
  buildTrnDocumentHeuristic,
  extractHardwareAndTemps,
  extractRecipeFromRawText,
} from '../worker/heuristicParser';
import { APP_VERSION } from '../shared/version';
import { ControlToolbar } from './components/ControlToolbar';
import { HeaderSpecBar } from './components/HeaderSpecBar';
import { NestedTrnTable } from './components/NestedTrnTable';
import { RecipeInputPanel } from './components/RecipeInputPanel';
import { RowEditModal } from './components/RowEditModal';
import { SpecHeaderBlock } from './components/SpecHeaderBlock';
import { StepSummaryTable } from './components/StepSummaryTable';
import { exportRecipeToPdf, triggerNativePrint } from './utils/pdfExport';
import {
  moveIngredientRowInDoc,
  removeIngredientRowFromDoc,
  splitIngredientRowInDoc,
  syncSummaryRowsFromDocument,
} from './utils/trnMatrix';

/** Minimal WakeLockSentinel structural interface for TypeScript DOM safety. */
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
}

/**
 * Extracts a shared link token or ID from either `?r=...` or `/r/<id>`.
 */
function extractShareIdentifierFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const queryToken = params.get('r');
  if (queryToken) return queryToken;

  const pathMatch = window.location.pathname.match(/^\/r\/([a-zA-Z0-9._-]+)$/);
  return pathMatch ? pathMatch[1] : null;
}

export const App: React.FC = () => {
  const [originalDoc, setOriginalDoc] = useState<TrnRecipeDocument | null>(null);
  const [doc, setDoc] = useState<TrnRecipeDocument | null>(null);

  const [viewMode, setViewMode] = useState<TrnViewMode>('nested');
  const [scaleFactor, setScaleFactor] = useState<number>(1);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('original');
  const [fontScale, setFontScale] = useState<number>(100);
  const [inputCollapsed, setInputCollapsed] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [edgeCapabilities, setEdgeCapabilities] = useState({ ai: false, kv: false });

  // Kitchen Bench Mode + Wake Lock
  const [benchMode, setBenchMode] = useState(false);
  const [wakeLockStatus, setWakeLockStatus] = useState<'off' | 'active' | 'unsupported'>('off');
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  // Share link state
  const [sharingInProgress, setSharingInProgress] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);

  // PDF & Modal state
  const [exportingPdf, setExportingPdf] = useState(false);
  const [addRowModalOpen, setAddRowModalOpen] = useState(false);
  const blueprintRef = useRef<HTMLDivElement | null>(null);

  // ============================================================================
  // Startup: Check Worker Health & Load Any Shared Link (?r= or /r/:id)
  // ============================================================================

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { bindings?: { ai?: boolean; kv?: boolean } } | null) => {
        if (data?.bindings) {
          setEdgeCapabilities({
            ai: Boolean(data.bindings.ai),
            kv: Boolean(data.bindings.kv),
          });
        }
      })
      .catch(() => {
        // Offline or static-only mode; defaults remain false cleanly
      });

    const shareId = extractShareIdentifierFromLocation();
    if (!shareId) return;

    setLoading(true);
    fetch(`/api/share/${encodeURIComponent(shareId)}`)
      .then(async (res) => {
        const payload = (await res.json()) as LoadSharedRecipeResponse;
        if (!res.ok || !payload.ok || !payload.document) {
          setErrorMessage(
            payload.error ||
              (payload.expired
                ? 'This shared recipe link has expired (14-day retention exceeded).'
                : 'Shared recipe could not be loaded.')
          );
          return;
        }
        setOriginalDoc(payload.document);
        setDoc(payload.document);
        setShareExpiresAt(payload.expiresAt || payload.document.metadata.expiresAt || null);
        setInputCollapsed(true);
      })
      .catch(() => {
        setErrorMessage('Unable to fetch shared recipe specification.');
      })
      .finally(() => setLoading(false));
  }, []);

  // ============================================================================
  // Screen Wake Lock Lifecycle for Kitchen Bench Mode
  // ============================================================================

  const acquireWakeLock = useCallback(async () => {
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) {
      setWakeLockStatus('unsupported');
      return;
    }
    try {
      wakeLockRef.current = await nav.wakeLock.request('screen');
      setWakeLockStatus('active');
    } catch {
      setWakeLockStatus('unsupported');
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // Ignore release errors if already released by OS
      }
    }
    wakeLockRef.current = null;
    setWakeLockStatus('off');
  }, []);

  useEffect(() => {
    if (!benchMode) {
      void releaseWakeLock();
      return;
    }

    void acquireWakeLock();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && benchMode) {
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void releaseWakeLock();
    };
  }, [benchMode, acquireWakeLock, releaseWakeLock]);

  // ============================================================================
  // Parsing Handlers (URL & Raw Text)
  // ============================================================================

  const loadNewDocument = (compiled: TrnRecipeDocument, newWarnings: string[] = []) => {
    setOriginalDoc(compiled);
    setDoc(compiled);
    setScaleFactor(1);
    setUnitSystem('original');
    setShareUrl(null);
    setShareExpiresAt(compiled.metadata.expiresAt || null);
    setWarnings(newWarnings);
    setErrorMessage(null);
    setInputCollapsed(true);
  };

  const handleParseUrl = async (url: string, preferAi: boolean) => {
    setLoading(true);
    setErrorMessage(null);
    setWarnings([]);

    try {
      const response = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, preferAi }),
      });
      const payload = (await response.json()) as ParseRecipeResponse;
      if (!response.ok || !payload.ok || !payload.document) {
        throw new Error(payload.error || 'Failed to parse URL.');
      }
      loadNewDocument(payload.document, payload.warnings || []);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to fetch recipe URL.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleParseRawText = async (rawText: string, preferAi: boolean) => {
    setLoading(true);
    setErrorMessage(null);
    setWarnings([]);

    try {
      const response = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText, preferAi }),
      });
      if (response.ok) {
        const payload = (await response.json()) as ParseRecipeResponse;
        if (payload.ok && payload.document) {
          loadNewDocument(payload.document, payload.warnings || []);
          return;
        }
      }
      // Fallback to zero-latency client-side heuristic compilation
      const rawExtracted = extractRecipeFromRawText(rawText);
      const localDoc = buildTrnDocumentHeuristic(rawExtracted);
      loadNewDocument(localDoc, ['Compiled locally with deterministic heuristic parser.']);
    } catch {
      const rawExtracted = extractRecipeFromRawText(rawText);
      const localDoc = buildTrnDocumentHeuristic(rawExtracted);
      loadNewDocument(localDoc, ['Compiled locally with deterministic heuristic parser.']);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // Inline Editing, Row Mutation & Kitchen Bench Handlers
  // ============================================================================

  const updateDoc = (updater: (prev: TrnRecipeDocument) => TrnRecipeDocument) => {
    setDoc((prev) => (prev ? updater(prev) : prev));
    setShareUrl(null);
  };

  const handleUpdateIngredientField = (
    ingredientId: string,
    field: 'name' | 'prepNote',
    value: string
  ) => {
    updateDoc((prev) => {
      const cleaned = field === 'prepNote' ? value.replace(/^,\s*/, '') : value;
      const nextIngredients = prev.ingredients.map((ing) =>
        ing.id === ingredientId ? { ...ing, [field]: cleaned } : ing
      );
      const nextDoc = { ...prev, ingredients: nextIngredients };
      return { ...nextDoc, summaryRows: syncSummaryRowsFromDocument(nextDoc) };
    });
  };

  const handleUpdateActionField = (
    actionId: string,
    field: 'instruction' | 'outputLabel',
    value: string
  ) => {
    updateDoc((prev) => {
      const nextActions = prev.actions.map((act) =>
        act.id === actionId ? { ...act, [field]: value } : act
      );
      const nextDoc = { ...prev, actions: nextActions };
      return { ...nextDoc, summaryRows: syncSummaryRowsFromDocument(nextDoc) };
    });
  };

  const handleUpdateSummaryParams = (summaryId: string, value: string) => {
    updateDoc((prev) => ({
      ...prev,
      summaryRows: prev.summaryRows.map((row) =>
        row.id === summaryId ? { ...row, parametersText: value } : row
      ),
    }));
  };

  const handleAddCustomIngredient = (newRow: IngredientRow) => {
    updateDoc((prev) => {
      const nextIngredients = [...prev.ingredients, newRow].sort(
        (a, b) => a.firstUsedStepIndex - b.firstUsedStepIndex
      );
      const instructions = prev.actions.map((a) => a.instruction);
      const { stepParams } = extractHardwareAndTemps(instructions);
      const { actions, summaryRows } = buildContiguousTrnGraph(
        nextIngredients,
        instructions,
        stepParams
      );
      return { ...prev, ingredients: nextIngredients, actions, summaryRows };
    });
  };

  const handleToggleIngredientDone = (ingredientId: string) => {
    updateDoc((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ing) =>
        ing.id === ingredientId ? { ...ing, completed: !ing.completed } : ing
      ),
    }));
  };

  const handleToggleActionDone = (actionId: string) => {
    updateDoc((prev) => {
      const nextActions = prev.actions.map((act) =>
        act.id === actionId ? { ...act, completed: !act.completed } : act
      );
      const nextSummary = prev.summaryRows.map((row) =>
        row.id === actionId ? { ...row, completed: !row.completed } : row
      );
      return { ...prev, actions: nextActions, summaryRows: nextSummary };
    });
  };

  // ============================================================================
  // Share (14-Day TTL) & PDF Export Handlers
  // ============================================================================

  const handleShareRecipe = async () => {
    if (!doc) return;
    setSharingInProgress(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: doc }),
      });
      const payload = (await response.json()) as ShareRecipeResponse;
      if (!response.ok || !payload.ok || !payload.sharePath) {
        throw new Error(payload.error || 'Could not save shareable link.');
      }

      const fullUrl = payload.sharePath.startsWith('?')
        ? `${window.location.origin}${window.location.pathname}${payload.sharePath}`
        : `${window.location.origin}${payload.sharePath}`;

      setShareUrl(fullUrl);
      setShareExpiresAt(payload.expiresAt || null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to generate 14-day share link.'
      );
    } finally {
      setSharingInProgress(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!doc || !blueprintRef.current) return;
    setExportingPdf(true);
    try {
      await exportRecipeToPdf(blueprintRef.current, doc, 'landscape');
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="app-shell">
      <HeaderSpecBar
        hasDocument={Boolean(doc)}
        inputCollapsed={inputCollapsed}
        edgeCapabilities={edgeCapabilities}
        onToggleInputPanel={() => setInputCollapsed((prev) => !prev)}
      />

      <RecipeInputPanel
        loading={loading}
        hasDocument={Boolean(doc)}
        isCollapsed={inputCollapsed}
        errorMessage={errorMessage}
        warnings={warnings}
        onExpand={() => setInputCollapsed(false)}
        onCollapse={() => setInputCollapsed(true)}
        onParseUrl={handleParseUrl}
        onParseRawText={handleParseRawText}
      />

      {doc && (
        <>
          <ControlToolbar
            viewMode={viewMode}
            onChangeViewMode={setViewMode}
            scaleFactor={scaleFactor}
            onChangeScaleFactor={setScaleFactor}
            unitSystem={unitSystem}
            onChangeUnitSystem={setUnitSystem}
            fontScale={fontScale}
            onChangeFontScale={setFontScale}
            benchMode={benchMode}
            wakeLockStatus={wakeLockStatus}
            onToggleBenchMode={() => setBenchMode((b) => !b)}
            onOpenAddRowModal={() => setAddRowModalOpen(true)}
            onResetEdits={() => {
              if (originalDoc) {
                setDoc(originalDoc);
                setScaleFactor(1);
                setUnitSystem('original');
                setShareUrl(null);
              }
            }}
            onShareRecipe={handleShareRecipe}
            sharingInProgress={sharingInProgress}
            shareUrl={shareUrl}
            shareExpiresAt={shareExpiresAt}
            onDownloadPdf={handleDownloadPdf}
            exportingPdf={exportingPdf}
            onPrintBlueprint={triggerNativePrint}
          />

          <main
            ref={blueprintRef}
            className="blueprint-sheet"
            style={{ '--trn-font-scale': fontScale / 100 } as React.CSSProperties}
          >
            <SpecHeaderBlock
              document={doc}
              scaleFactor={scaleFactor}
              unitSystem={unitSystem}
              onUpdateTitle={(title) => updateDoc((prev) => ({ ...prev, title }))}
              onAddHardware={(hw) =>
                updateDoc((prev) => ({
                  ...prev,
                  metadata: {
                    ...prev.metadata,
                    hardware: prev.metadata.hardware.includes(hw)
                      ? prev.metadata.hardware
                      : [...prev.metadata.hardware, hw],
                  },
                }))
              }
              onRemoveHardware={(hw) =>
                updateDoc((prev) => ({
                  ...prev,
                  metadata: {
                    ...prev.metadata,
                    hardware: prev.metadata.hardware.filter((item) => item !== hw),
                  },
                }))
              }
            />

            {viewMode === 'nested' ? (
              <NestedTrnTable
                document={doc}
                scaleFactor={scaleFactor}
                unitSystem={unitSystem}
                benchMode={benchMode}
                onUpdateIngredientField={handleUpdateIngredientField}
                onUpdateActionField={handleUpdateActionField}
                onSplitIngredient={(id) =>
                  updateDoc((prev) => splitIngredientRowInDoc(prev, id))
                }
                onMoveIngredient={(id, dir) =>
                  updateDoc((prev) => moveIngredientRowInDoc(prev, id, dir))
                }
                onRemoveIngredient={(id) =>
                  updateDoc((prev) => removeIngredientRowFromDoc(prev, id))
                }
                onToggleIngredientDone={handleToggleIngredientDone}
                onToggleActionDone={handleToggleActionDone}
              />
            ) : (
              <StepSummaryTable
                document={doc}
                scaleFactor={scaleFactor}
                unitSystem={unitSystem}
                benchMode={benchMode}
                onUpdateActionField={handleUpdateActionField}
                onUpdateSummaryParams={handleUpdateSummaryParams}
                onToggleActionDone={handleToggleActionDone}
              />
            )}

            <footer className="sheet-footer">
              <span>
                FORMAT: TABULAR RECIPE NOTATION ({viewMode.toUpperCase()}) // SCALE: {scaleFactor}x // UNITS: {unitSystem.toUpperCase()}
              </span>
              <span>
                GENERATED BY UNFLUFFRECIPES v{window.api?.appVersion || APP_VERSION}
              </span>
            </footer>
          </main>

          <RowEditModal
            isOpen={addRowModalOpen}
            actions={doc.actions}
            onClose={() => setAddRowModalOpen(false)}
            onAddIngredient={handleAddCustomIngredient}
          />
        </>
      )}
    </div>
  );
};

export default App;
