/**
 * ============================================================================
 * Client-Side PDF Export & Blueprint Print Controller
 * ----------------------------------------------------------------------------
 * Generates clean single-sheet or multi-page technical PDF documents directly
 * inside the user's browser using `html2pdf.js` (zero server round-trip),
 * with a fallback to native browser vector printing (`window.print()`).
 * ============================================================================
 */

import type { TrnRecipeDocument } from '../../shared/types';

/**
 * Converts a recipe title into a filesystem-safe slug for `.pdf` downloads.
 */
export function buildPdfFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'recipe'}-trn-spec.pdf`;
}

/**
 * Captures the rendered Spec Block + TRN Table DOM container into a client-side
 * PDF file download using `html2pdf.js`. Temporarily applies `pdf-exporting`
 * CSS class to hide interactive editing chrome during rasterization.
 *
 * @param element - Root DOM node wrapping `SpecHeaderBlock` + TRN table.
 * @param doc - Active TrnRecipeDocument used to name the downloaded file.
 * @param orientation - Target PDF page orientation (`landscape` recommended for Nested Grid).
 */
export async function exportRecipeToPdf(
  element: HTMLElement,
  doc: TrnRecipeDocument,
  orientation: 'landscape' | 'portrait' = 'landscape'
): Promise<void> {
  element.classList.add('pdf-exporting');

  try {
    const mod = await import('html2pdf.js');
    const html2pdf =
      typeof mod.default === 'function'
        ? mod.default
        : ((mod as unknown as { default?: typeof mod.default }).default ??
          (mod as unknown as typeof mod.default));

    await html2pdf()
      .set({
        margin: [6, 6, 6, 6],
        filename: buildPdfFilename(doc.title),
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          windowWidth: Math.max(element.scrollWidth, 1120),
        },
        jsPDF: {
          unit: 'mm',
          format: 'letter',
          orientation,
        },
      })
      .from(element)
      .save();
  } catch {
    // Graceful fallback to high-resolution browser vector Print-to-PDF
    window.print();
  } finally {
    element.classList.remove('pdf-exporting');
  }
}

/**
 * Invokes the browser's native print engine styled by `@media print` rules.
 */
export function triggerNativePrint(): void {
  window.print();
}
