/**
 * ============================================================================
 * Deterministic Heuristic Recipe Parser & TRN Graph Compiler
 * ----------------------------------------------------------------------------
 * Zero-dependency (browser + Worker compatible) NLP and topological sorting
 * engine that:
 *   1. Extracts recipe sections from pasted unstructured text.
 *   2. Lexes ingredient lines (Unicode fractions, ranges, units, prep notes).
 *   3. Automatically splits "divided" ingredients into separate step-pinned
 *      rows so merged TRN cells stay 100% contiguous.
 *   4. Extracts required cookware/hardware and critical target temperatures.
 *   5. Compiles ingredients and instructions into a topological Tabular Recipe
 *      Notation (TRN) DAG and Row-per-Step Engineering Summary table.
 * ============================================================================
 */

import type {
  ExtractedRawRecipe,
  IngredientRow,
  RecipeSpecMetadata,
  TrnActionNode,
  TrnRecipeDocument,
  TrnStepSummaryRow,
} from '../shared/types';

// ============================================================================
// Constants & Culinary Dictionaries
// ============================================================================

/** Mapping of Unicode vulgar fractions to decimal equivalents. */
const UNICODE_FRACTIONS: Record<string, string> = {
  '½': '1/2',
  '⅓': '1/3',
  '⅔': '2/3',
  '¼': '1/4',
  '¾': '3/4',
  '⅕': '1/5',
  '⅖': '2/5',
  '⅗': '3/5',
  '⅘': '4/5',
  '⅙': '1/6',
  '⅚': '5/6',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
};

/** Canonical unit normalization lookup. */
const UNIT_NORMALIZATION: Record<string, string> = {
  t: 'tsp',
  tsp: 'tsp',
  'tsp.': 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  T: 'tbsp',
  tbs: 'tbsp',
  'tbs.': 'tbsp',
  tbsp: 'tbsp',
  'tbsp.': 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  c: 'cup',
  cup: 'cup',
  cups: 'cup',
  oz: 'oz',
  'oz.': 'oz',
  ounce: 'oz',
  ounces: 'oz',
  'fl oz': 'fl oz',
  'fl. oz.': 'fl oz',
  'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz',
  lb: 'lb',
  'lb.': 'lb',
  lbs: 'lb',
  'lbs.': 'lb',
  pound: 'lb',
  pounds: 'lb',
  g: 'g',
  'g.': 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  ml: 'mL',
  'ml.': 'mL',
  milliliter: 'mL',
  milliliters: 'mL',
  millilitre: 'mL',
  millilitres: 'mL',
  l: 'L',
  liter: 'L',
  liters: 'L',
  litre: 'L',
  litres: 'L',
  pt: 'pt',
  pint: 'pt',
  pints: 'pt',
  qt: 'qt',
  quart: 'qt',
  quarts: 'qt',
  gal: 'gal',
  gallon: 'gal',
  gallons: 'gal',
  stick: 'stick',
  sticks: 'stick',
  clove: 'clove',
  cloves: 'clove',
  can: 'can',
  cans: 'can',
  package: 'pkg',
  packages: 'pkg',
  pkg: 'pkg',
  pkgs: 'pkg',
  bunch: 'bunch',
  bunches: 'bunch',
  sprig: 'sprig',
  sprigs: 'sprig',
  pinch: 'pinch',
  pinches: 'pinch',
  dash: 'dash',
  dashes: 'dash',
  slice: 'slice',
  slices: 'slice',
  piece: 'piece',
  pieces: 'piece',
  head: 'head',
  heads: 'head',
  stalk: 'stalk',
  stalks: 'stalk',
  sheet: 'sheet',
  sheets: 'sheet',
  strip: 'strip',
  strips: 'strip',
  drop: 'drop',
  drops: 'drop',
  large: 'large',
  medium: 'medium',
  small: 'small',
};

/** Ordered list of culinary hardware phrases (longer/more specific phrases first). */
const HARDWARE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcast[- ]iron skillet\b/i, label: 'Cast-iron skillet' },
  { pattern: /\bdutch oven\b/i, label: 'Dutch oven' },
  { pattern: /\binstant[- ]read thermometer\b/i, label: 'Instant-read thermometer' },
  { pattern: /\bcandy thermometer\b/i, label: 'Candy thermometer' },
  { pattern: /\bmeat thermometer\b/i, label: 'Meat thermometer' },
  { pattern: /\bstand mixer\b/i, label: 'Stand mixer' },
  { pattern: /\bhand mixer\b/i, label: 'Hand mixer' },
  { pattern: /\bfood processor\b/i, label: 'Food processor' },
  { pattern: /\bimmersion blender\b/i, label: 'Immersion blender' },
  { pattern: /\bwire (?:cooling )?rack\b/i, label: 'Wire cooling rack' },
  { pattern: /\bcooling rack\b/i, label: 'Wire cooling rack' },
  { pattern: /\bfine[- ]mesh (?:sieve|strainer)\b/i, label: 'Fine-mesh sieve' },
  { pattern: /\bbaking sheet\b/i, label: 'Baking sheet' },
  { pattern: /\bsheet pan\b/i, label: 'Sheet pan' },
  { pattern: /\broasting pan\b/i, label: 'Roasting pan' },
  { pattern: /\bbaking dish\b/i, label: 'Baking dish' },
  { pattern: /\bcasserole dish\b/i, label: 'Casserole dish' },
  { pattern: /\bloaf pan\b/i, label: 'Loaf pan' },
  { pattern: /\bcake pan\b/i, label: 'Cake pan' },
  { pattern: /\bmuffin tin\b/i, label: 'Muffin tin' },
  { pattern: /\bparchment paper\b/i, label: 'Parchment paper' },
  { pattern: /\bsilicone mat\b/i, label: 'Silicone baking mat' },
  { pattern: /\baluminum foil\b/i, label: 'Aluminum foil' },
  { pattern: /\bslow cooker\b/i, label: 'Slow cooker' },
  { pattern: /\bpressure cooker\b/i, label: 'Pressure cooker' },
  { pattern: /\bair fryer\b/i, label: 'Air fryer' },
  { pattern: /\bstockpot\b/i, label: 'Stockpot' },
  { pattern: /\bsaucepan\b/i, label: 'Saucepan' },
  { pattern: /\bskillet\b/i, label: 'Skillet' },
  { pattern: /\bfrying pan\b/i, label: 'Frying pan' },
  { pattern: /\bwok\b/i, label: 'Wok' },
  { pattern: /\bblender\b/i, label: 'Blender' },
  { pattern: /\bmixing bowl\b/i, label: 'Mixing bowl' },
  { pattern: /\bbowl\b/i, label: 'Mixing bowl' },
  { pattern: /\bwhisk\b/i, label: 'Whisk' },
  { pattern: /\bspatula\b/i, label: 'Spatula' },
  { pattern: /\bwooden spoon\b/i, label: 'Wooden spoon' },
  { pattern: /\brolling pin\b/i, label: 'Rolling pin' },
  { pattern: /\bpastry brush\b/i, label: 'Pastry brush' },
  { pattern: /\bcolander\b/i, label: 'Colander' },
  { pattern: /\btongs\b/i, label: 'Tongs' },
  { pattern: /\bcutting board\b/i, label: 'Cutting board' },
  { pattern: /\boven\b/i, label: 'Oven' },
  { pattern: /\bbroiler\b/i, label: 'Broiler' },
  { pattern: /\bgrill\b/i, label: 'Grill' },
];

/** Collective ingredient categories used when instructions say e.g. "whisk dry ingredients". */
const COLLECTIVE_GROUPS: Array<{ trigger: RegExp; memberKeywords: string[] }> = [
  {
    trigger: /\bdry ingredients\b/i,
    memberKeywords: [
      'flour',
      'baking soda',
      'baking powder',
      'salt',
      'cocoa',
      'cornstarch',
      'cinnamon',
      'nutmeg',
      'ginger',
      'cloves',
      'oats',
      'yeast',
      'meal',
    ],
  },
  {
    trigger: /\bwet ingredients\b/i,
    memberKeywords: [
      'milk',
      'buttermilk',
      'cream',
      'egg',
      'eggs',
      'vanilla',
      'oil',
      'water',
      'yogurt',
      'sour cream',
      'honey',
      'maple',
      'molasses',
    ],
  },
  {
    trigger: /\b(?:spices|seasonings?)\b/i,
    memberKeywords: [
      'salt',
      'pepper',
      'spice',
      'spices',
      'paprika',
      'cumin',
      'oregano',
      'thyme',
      'rosemary',
      'cayenne',
      'chili',
      'coriander',
      'turmeric',
      'cinnamon',
      'nutmeg',
      'ginger',
      'clove',
      'allspice',
      'cardamom',
    ],
  },
  {
    trigger: /\baromatics\b/i,
    memberKeywords: ['onion', 'garlic', 'shallot', 'celery', 'carrot', 'ginger', 'scallion', 'leek'],
  },
];

/** Stopwords ignored during ingredient-to-step keyword matching. */
const MATCH_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'and',
  'or',
  'with',
  'to',
  'for',
  'in',
  'on',
  'at',
  'into',
  'from',
  'by',
  'fresh',
  'freshly',
  'dried',
  'ground',
  'whole',
  'chopped',
  'diced',
  'minced',
  'sliced',
  'grated',
  'shredded',
  'melted',
  'softened',
  'unsalted',
  'salted',
  'raw',
  'cooked',
  'cold',
  'warm',
  'hot',
  'room',
  'temperature',
  'large',
  'medium',
  'small',
  'extra',
  'virgin',
  'all',
  'purpose',
  'all-purpose',
  'granulated',
  'packed',
  'light',
  'dark',
  'pure',
  'fine',
  'coarse',
  'flaky',
  'kosher',
  'sea',
  'divided',
  'optional',
  'taste',
  'needed',
  'about',
  'plus',
  'more',
]);

/** Common cooking verbs prioritized when extracting the lead action verb. */
const COOKING_VERBS = [
  'PREHEAT',
  'WHISK',
  'CREAM',
  'BEAT',
  'MIX',
  'STIR',
  'FOLD',
  'KNEAD',
  'COMBINE',
  'BLEND',
  'PUREE',
  'PULSE',
  'SIFT',
  'MELT',
  'BROWN',
  'SEAR',
  'SAUTE',
  'SAUTÉ',
  'FRY',
  'SIMMER',
  'BOIL',
  'REDUCE',
  'DEGLAZE',
  'POACH',
  'STEAM',
  'ROAST',
  'BAKE',
  'BROIL',
  'GRILL',
  'TOAST',
  'CHILL',
  'COOL',
  'REST',
  'MARINATE',
  'SEASON',
  'COAT',
  'TOSS',
  'POUR',
  'SPREAD',
  'TRANSFER',
  'GARNISH',
  'SERVE',
];

// ============================================================================
// Raw Text Recipe Extractor (Client + Worker Compatible)
// ============================================================================

/**
 * Extracts title, metadata, ingredients list, and instruction steps from raw
 * copy-pasted recipe text without needing DOM or network dependencies.
 *
 * @param rawText - Pasted recipe text (title, ingredients, instructions).
 * @returns Structured ExtractedRawRecipe ready for TRN compilation.
 */
export function extractRecipeFromRawText(rawText: string): ExtractedRawRecipe {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let title = 'Untitled Recipe Spec';
  let servings = 4;
  let yieldLabel = '4 servings';
  let prepTime: string | undefined;
  let cookTime: string | undefined;
  let totalTime: string | undefined;

  const rawIngredients: string[] = [];
  const rawInstructions: string[] = [];

  type Section = 'preamble' | 'ingredients' | 'instructions' | 'notes';
  let currentSection: Section = 'preamble';

  // Heuristic pattern to distinguish an ingredient line when no section headers exist.
  const autoIngredientRegex =
    /^(?:[-*•☐]\s*)?(?:(?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:\.\d+)?)|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])(?:\s*(?:-|–|to)\s*(?:(?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:\.\d+)?)|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]))?\s*(?:g|kg|mg|oz|fl\.?\s*oz|lb|lbs|ml|l|cups?|c|tbsp|tbs|tsp|teaspoons?|tablespoons?|cans?|cloves?|pinch(?:es)?|dash(?:es)?|slices?|pieces?|heads?|stalks?|sheets?|strips?|drops?|sticks?|pkg|packages?|bunches?|sprigs?|large|medium|small|\(\d)/iu;
  const bulletedIngredientRegex =
    /^[-*•☐]\s+(?:\d+[\d\s/.-]*|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/u;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const cleanHeader = line.replace(/[:\-–—\s]+$/g, '').toLowerCase();

    // Detect explicit section dividers
    if (/^(?:ingredients?|what you need|components|mise en place)$/i.test(cleanHeader)) {
      currentSection = 'ingredients';
      continue;
    }
    if (/^(?:instructions?|directions?|method|preparation|steps?|procedure)$/i.test(cleanHeader)) {
      currentSection = 'instructions';
      continue;
    }
    if (/^(?:notes?|tips?|nutrition)$/i.test(cleanHeader)) {
      currentSection = 'notes';
      continue;
    }

    // Extract inline metadata in preamble lines
    if (currentSection === 'preamble') {
      const prepMatch = line.match(/^prep(?:\s*time)?:\s*(.+)$/i);
      if (prepMatch) {
        prepTime = prepMatch[1].trim();
        continue;
      }
      const cookMatch = line.match(/^cook(?:\s*time)?:\s*(.+)$/i);
      if (cookMatch) {
        cookTime = cookMatch[1].trim();
        continue;
      }
      const totalMatch = line.match(/^total(?:\s*time)?:\s*(.+)$/i);
      if (totalMatch) {
        totalTime = totalMatch[1].trim();
        continue;
      }
      const yieldMatch = line.match(/^(?:yield|servings?|makes?):\s*(.+)$/i);
      if (yieldMatch) {
        yieldLabel = yieldMatch[1].trim();
        const num = yieldLabel.match(/(\d+(?:\.\d+)?)/);
        if (num) {
          servings = Math.max(1, Math.round(Number(num[1])));
        }
        continue;
      }

      const looksLikeAutoIngredient =
        line.length <= 120 &&
        !/^\d{4}\b/.test(line) &&
        !/^\d+[.)]\s+[A-Z]/.test(line) &&
        (autoIngredientRegex.test(line) || bulletedIngredientRegex.test(line));

      // Enter ingredients mode on "For the <component>:" subheader if next line looks like an ingredient
      if (/^for\s+the\s+[\w\s&-]+:$/i.test(line)) {
        currentSection = 'ingredients';
        continue;
      }

      // First non-metadata line becomes the title unless it already looks like an ingredient
      if (i === 0 && !looksLikeAutoIngredient) {
        title = line.replace(/^#+\s*/, '').trim();
        continue;
      }

      // Auto-enter ingredients mode only on confident ingredient lines
      if (looksLikeAutoIngredient) {
        currentSection = 'ingredients';
      } else {
        continue;
      }
    }

    if (currentSection === 'notes') {
      continue;
    }

    // Strip list prefixes (`- `, `* `, `1. `, `Step 1:`)
    const strippedBullet = line.replace(/^[-*•☐]\s*/, '').trim();

    if (currentSection === 'ingredients') {
      // Detect transition into numbered instructions or inline section steps without a header
      const looksLikeNumberedStep =
        /^(?:step\s*\d+[:.)]?|\d+[.)]\s+[A-Z])/i.test(line) && line.length > 35;
      const looksLikeInlineStepHeader =
        /^(?:make|to make|prepare|bake|assemble|cook|for the (?:cream|assembly|sauce|glaze|finishing))[^:]{0,35}:\s+\S/i.test(
          line
        ) && line.length > 35;

      if (looksLikeNumberedStep || looksLikeInlineStepHeader) {
        currentSection = 'instructions';
        rawInstructions.push(line.replace(/^(?:step\s*\d+[:.)]?\s*|\d+[.)]\s*)/i, '').trim());
      } else if (!/^for\s+the\s+.+:$/i.test(strippedBullet)) {
        rawIngredients.push(strippedBullet);
      }
      continue;
    }

    if (currentSection === 'instructions') {
      const cleanedStep = line
        .replace(/^(?:step\s*\d+[:.)]?\s*|\d+[.)]\s*|[-*•]\s*)/i, '')
        .trim();
      if (cleanedStep.length > 0) {
        rawInstructions.push(cleanedStep);
      }
    }
  }

  // Fallback: if no explicit instructions section was detected, split long sentences
  if (rawInstructions.length === 0 && lines.length > 1) {
    const remaining = lines.slice(1).filter((l) => !rawIngredients.includes(l));
    for (const r of remaining) {
      const cleaned = r.replace(/^(?:step\s*\d+[:.)]?\s*|\d+[.)]\s*|[-*•]\s*)/i, '').trim();
      if (cleaned.length > 10) {
        rawInstructions.push(cleaned);
      }
    }
  }

  return {
    title,
    prepTime,
    cookTime,
    totalTime,
    servings,
    yieldLabel,
    rawIngredients,
    rawInstructions,
    extractionMethod: 'raw-text',
  };
}

// ============================================================================
// Fraction & Ingredient Line Lexing
// ============================================================================

/**
 * Replaces Unicode fraction characters in a string with ASCII slash fractions.
 */
function normalizeUnicodeFractions(input: string): string {
  let out = input;
  for (const [glyph, ascii] of Object.entries(UNICODE_FRACTIONS)) {
    // Handle mixed number without space like "1½" -> "1 1/2"
    out = out.replace(new RegExp(`(\\d)${glyph}`, 'g'), `$1 ${ascii}`);
    out = out.replace(new RegExp(glyph, 'g'), ascii);
  }
  return out;
}

/**
 * Evaluates a numeric quantity token ("1 1/2", "3/4", "2.5") into a number.
 */
export function parseNumericToken(token: string): number | null {
  const trimmed = normalizeUnicodeFractions(token).trim();
  if (!trimmed) return null;

  // Mixed fraction e.g. "1 1/2" or "1-1/2"
  const mixed = trimmed.match(/^(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    return den !== 0 ? whole + num / den : null;
  }

  // Simple fraction e.g. "3/4"
  const frac = trimmed.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    return den !== 0 ? num / den : null;
  }

  // Standard integer or decimal
  const dec = Number(trimmed);
  return Number.isFinite(dec) ? dec : null;
}

/**
 * Parses a single raw ingredient string into a structured IngredientRow.
 *
 * @param rawLine - Raw ingredient text (e.g., "1 1/2 cups all-purpose flour, sifted").
 * @param index - Zero-based original index for stable ID generation.
 * @returns Parsed IngredientRow record.
 */
export function parseIngredientLine(rawLine: string, index: number): IngredientRow {
  const cleanedLine = normalizeUnicodeFractions(
    rawLine.replace(/^[-*•☐\s]+/, '').replace(/\s+/g, ' ').trim()
  );

  let remainder = cleanedLine;
  let quantity: number | null = null;
  let quantityMax: number | null = null;
  let rawQuantity = '';

  // Match range quantities like "2-3", "2 to 3", "1/2 - 3/4" (including attached units like "170g")
  const rangePattern =
    /^((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:\.\d+)?))\s*(?:-|–|to)\s*((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:\.\d+)?))(?=\s|$|[a-zA-Z(])\s*(.*)$/i;
  // Match single quantities like "1 1/2", "3/4", "2.5", "2", or "170g"
  const singlePattern =
    /^((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:\.\d+)?))(?=\s|$|[a-zA-Z(])\s*(.*)$/;

  const rangeMatch = remainder.match(rangePattern);
  if (rangeMatch) {
    quantity = parseNumericToken(rangeMatch[1]);
    quantityMax = parseNumericToken(rangeMatch[2]);
    rawQuantity = `${rangeMatch[1]}-${rangeMatch[2]}`;
    remainder = rangeMatch[3].trim();
  } else {
    const singleMatch = remainder.match(singlePattern);
    if (singleMatch) {
      quantity = parseNumericToken(singleMatch[1]);
      rawQuantity = singleMatch[1].trim();
      remainder = singleMatch[2].trim();
    }
  }

  // Extract parenthetical unit/weight annotations e.g. "(2 sticks)" or "(about 240g)"
  const parenNotes: string[] = [];
  remainder = remainder
    .replace(/\(([^)]+)\)/g, (_m, inner: string) => {
      parenNotes.push(inner.trim());
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  // Extract unit token at the start of the remaining text
  let unit = '';
  const twoWordUnitMatch = remainder.match(/^(fl\.?\s*oz\.?)\b\s*(.*)$/i);
  if (twoWordUnitMatch) {
    unit = UNIT_NORMALIZATION[twoWordUnitMatch[1].toLowerCase().replace(/\s+/g, ' ')] || 'fl oz';
    remainder = twoWordUnitMatch[2].trim();
  } else {
    const unitMatch = remainder.match(/^([a-zA-Z]+\.?)\b\s*(.*)$/);
    if (unitMatch) {
      const candidate = unitMatch[1];
      // Preserve single uppercase 'T' as tablespoon vs 't' as teaspoon; lowercase others
      const normalizedKey =
        candidate === 'T' || candidate === 't'
          ? candidate
          : candidate.toLowerCase();
      if (UNIT_NORMALIZATION[normalizedKey]) {
        unit = UNIT_NORMALIZATION[normalizedKey];
        remainder = unitMatch[2].trim();
      }
    }
  }

  // Strip leading "of " after unit (e.g., "1 cup of sugar")
  remainder = remainder.replace(/^of\s+/i, '').trim();

  // Separate comma-delimited prep notes (e.g., "unsalted butter, softened and divided")
  const commaParts = remainder.split(',').map((p) => p.trim()).filter(Boolean);
  let name = commaParts[0] || cleanedLine;
  const prepNotes: string[] = [...parenNotes, ...commaParts.slice(1)];

  // Handle "to taste" / "as needed" phrases at the end of name
  if (quantity === null && /\bto taste\b|\bas needed\b|\bfor garnish\b/i.test(name)) {
    const match = name.match(/\b(to taste|as needed|for garnish)\b/i);
    if (match) {
      rawQuantity = match[1].toLowerCase();
      name = name.replace(match[0], '').replace(/[,\s]+$/, '').trim() || name;
    }
  }

  // Detect trailing prep adjectives when no comma was used (e.g., "1/2 tsp salt divided")
  if (/\bdivided\b/i.test(name)) {
    name = name.replace(/\bdivided\b/i, '').replace(/\s+/g, ' ').trim();
    if (!prepNotes.some((n) => /\bdivided\b/i.test(n))) {
      prepNotes.push('divided');
    }
  }

  // Extract leading state modifiers directly before the core noun (e.g., "softened cream cheese")
  const leadingStateMatch = name.match(
    /^(softened|melted|chilled|room[- ]temperature|sifted|beaten|whisked|crushed)\s+(.+)$/i
  );
  if (leadingStateMatch && leadingStateMatch[2].trim().length >= 3) {
    const stateNote = leadingStateMatch[1].toLowerCase().replace(/\s+/g, ' ');
    name = leadingStateMatch[2].trim();
    if (!prepNotes.some((n) => n.toLowerCase().includes(stateNote))) {
      prepNotes.push(stateNote);
    }
  }

  return {
    id: `ing-${index + 1}`,
    quantity,
    quantityMax,
    rawQuantity,
    unit,
    name: name || cleanedLine,
    prepNote: prepNotes.join(', '),
    firstUsedStepIndex: 0,
    completed: false,
  };
}

// ============================================================================
// Keyword Extraction & Step Matching Helpers
// ============================================================================

/**
 * Extracts normalized base tokens from an ingredient name (in order).
 */
function extractBaseIngredientTokens(ingredientName: string): string[] {
  return ingredientName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length >= 3 && !MATCH_STOPWORDS.has(tok));
}

/**
 * Normalizes an ingredient name into a canonical key for duplicate detection
 * across multi-component recipes (e.g. "fine salt" in Crust & Filling).
 */
function normalizeIngredientKey(ingredientName: string): string {
  const tokens = extractBaseIngredientTokens(ingredientName);
  return tokens.join(' ') || ingredientName.toLowerCase().trim();
}

/**
 * Extracts normalized content keywords (including singular stems and compound
 * forms like "ginger snaps" -> "gingersnaps") for matching against steps.
 */
function extractIngredientKeywords(ingredientName: string): string[] {
  const tokens = extractBaseIngredientTokens(ingredientName);

  const expanded = new Set<string>();
  for (const tok of tokens) {
    expanded.add(tok);
    // Add singular stem for simple English plurals
    if (tok.endsWith('ies') && tok.length > 4) {
      expanded.add(`${tok.slice(0, -3)}y`);
    } else if (tok.endsWith('es') && tok.length > 4) {
      expanded.add(tok.slice(0, -2));
    } else if (tok.endsWith('s') && tok.length > 3) {
      expanded.add(tok.slice(0, -1));
    }
  }

  if (tokens.length >= 2) {
    const joined = tokens.join('');
    expanded.add(joined);
    if (joined.endsWith('s') && joined.length > 4) {
      expanded.add(joined.slice(0, -1));
    }
  }

  return Array.from(expanded);
}

function scoreTextAgainstIngredient(text: string, ingredient: IngredientRow): number {
  const lowerStep = text.toLowerCase();
  const compactStep = lowerStep.replace(/[\s-]+/g, '');
  const baseTokens = extractBaseIngredientTokens(ingredient.name);
  const keywords = extractIngredientKeywords(ingredient.name);

  let score = 0;

  // Full cleaned phrase match (e.g. "pumpkin pie spice", "cream cheese", "olive oil")
  if (baseTokens.length >= 2) {
    const phrase = baseTokens.join('\\s+');
    if (new RegExp(`\\b${phrase}s?\\b`, 'i').test(lowerStep)) {
      score += 10;
    }
    const compactPhrase = baseTokens.join('');
    if (
      compactPhrase.length >= 6 &&
      new RegExp(`\\b${compactPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(
        lowerStep
      )
    ) {
      score += 10;
    }
  }

  // Head noun (final meaningful token, e.g. "spice" in "pumpkin pie spice")
  const headToken = baseTokens[baseTokens.length - 1];
  if (headToken) {
    const headForms = extractIngredientKeywords(headToken);
    const headHit = headForms.some((kw) =>
      new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(lowerStep)
    );
    if (headHit) {
      const escHead = headToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hasDirectAdditionCue = new RegExp(
        `(?:\\b(?:tablespoons?|tbsp|teaspoons?|tsp|cups?|oz|grams?|ml|remaining|add(?:ing)?|stir\\s+in|pour\\s+in|whisk\\s+in)\\s+(?:of\\s+)?(?:the\\s+)?${escHead}s?\\b)`,
        'i'
      ).test(lowerStep);
      score += baseTokens.length >= 2 ? (hasDirectAdditionCue ? 5 : 2) : 4;
    }
  }

  // Individual keyword / stem / de-spaced match
  if (score === 0 && keywords.length > 0) {
    for (const kw of keywords) {
      const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i');
      if (regex.test(lowerStep)) {
        score += 1;
      } else if (kw.length >= 8 && compactStep.includes(kw)) {
        score += 4;
      }
    }
  }

  // Collective category fallback ("dry ingredients", "wet ingredients", "spices")
  if (score === 0) {
    const lowerIng = ingredient.name.toLowerCase();
    for (const group of COLLECTIVE_GROUPS) {
      if (group.trigger.test(lowerStep)) {
        if (group.memberKeywords.some((mk) => lowerIng.includes(mk))) {
          score += 3;
          break;
        }
      }
    }
  }

  // Prep-state disambiguation bonus (e.g. "melted butter" vs "melt the butter")
  if (score > 0 && ingredient.prepNote) {
    const prepWords = ingredient.prepNote
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4 && !/^(?:about|part|step)$/.test(w));
    for (const pw of prepWords) {
      if (new RegExp(`\\b${pw}\\b`, 'i').test(lowerStep)) {
        score += 3;
        break;
      }
    }
  }

  return score;
}

/**
 * Scores how strongly an instruction step references an ingredient (0 = no match).
 * Prioritizes main step instructions over parenthetical side-notes.
 */
function scoreStepIngredientMatch(stepText: string, ingredient: IngredientRow): number {
  const mainText = stepText.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const mainScore = scoreTextAgainstIngredient(mainText, ingredient);
  if (mainScore > 0) return mainScore;

  const fullScore = scoreTextAgainstIngredient(stepText, ingredient);
  return fullScore > 0 ? Math.max(1, Math.floor(fullScore / 2)) : 0;
}

// ============================================================================
// Automatic "Divided Ingredient" Row Splitting
// ============================================================================

/**
 * Detects divided ingredients (explicitly labeled "divided" or explicitly
 * portioned across multiple non-adjacent steps) and splits them into separate
 * IngredientRow entries pinned to their exact `firstUsedStepIndex`.
 *
 * This guarantees the topological TRN grid never suffers crossing lines when an
 * ingredient enters at two separate stages (e.g., half in the batter, half on top).
 *
 * @param ingredients - Parsed initial IngredientRow array.
 * @param instructions - Array of recipe instruction strings.
 * @returns Updated IngredientRow list with divided entries split into part rows.
 */
export function splitDividedIngredients(
  ingredients: IngredientRow[],
  instructions: string[]
): IngredientRow[] {
  if (instructions.length <= 1) {
    return ingredients;
  }

  // Count repeated ingredient names across multi-component recipes so already-separated
  // rows (e.g. "fine salt" listed in crust, filling, and topping) are not split again.
  const nameCounts = new Map<string, number>();
  for (const ing of ingredients) {
    const key = normalizeIngredientKey(ing.name);
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }

  const result: IngredientRow[] = [];

  for (const row of ingredients) {
    const isExplicitlyDivided =
      /\bdivided\b/i.test(row.prepNote) || /\bdivided\b/i.test(row.name);
    const key = normalizeIngredientKey(row.name);
    const isAlreadyRepeatedComponent = (nameCounts.get(key) || 0) >= 2;

    if (isAlreadyRepeatedComponent && !isExplicitlyDivided) {
      result.push(row);
      continue;
    }

    // Find all steps that reference this ingredient meaningfully
    const matchingStepIndices: number[] = [];
    for (let s = 0; s < instructions.length; s += 1) {
      const score = scoreStepIngredientMatch(instructions[s], row);
      if (isExplicitlyDivided ? score > 0 : score >= 4) {
        matchingStepIndices.push(s);
      }
    }

    // Also check if explicit divided ingredient only matched 1 step by keyword,
    // while a later step references "remaining" / "rest" / "reserve" / "top".
    if (isExplicitlyDivided && matchingStepIndices.length === 1) {
      const firstIdx = matchingStepIndices[0];
      for (let s = firstIdx + 1; s < instructions.length; s += 1) {
        if (/\b(?:remaining|rest|reserved?|garnish|top|finish|sprinkle)\b/i.test(instructions[s])) {
          matchingStepIndices.push(s);
          break;
        }
      }
      // If still only 1 step, assign second part to final step so divided status is honored
      if (matchingStepIndices.length === 1 && firstIdx < instructions.length - 1) {
        matchingStepIndices.push(instructions.length - 1);
      }
    }

    // Check implicit split cues when not marked "divided" (e.g., "half of the butter ... remaining butter")
    const keywords = extractIngredientKeywords(row.name);
    const hasSplitCue =
      !isExplicitlyDivided &&
      matchingStepIndices.length >= 2 &&
      matchingStepIndices.some((sIdx) => {
        const stepLower = instructions[sIdx].toLowerCase();
        return keywords.some((kw) => {
          const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return (
            new RegExp(`\\b(?:half(?:\\s+of)?|remaining|rest\\s+of|reserve|set\\s+aside)\\b[^.;]{0,40}\\b${esc}s?\\b`, 'i').test(stepLower) ||
            new RegExp(`\\b${esc}s?\\b[^.;]{0,30}\\b(?:remaining|set\\s+aside|reserved)\\b`, 'i').test(stepLower)
          );
        });
      });

    if ((!isExplicitlyDivided && !hasSplitCue) || matchingStepIndices.length < 2) {
      result.push(row);
      continue;
    }

    // Calculate proportional split quantities for each matching step
    const partCount = matchingStepIndices.length;
    const partQuantities = allocateDividedQuantities(row, matchingStepIndices, instructions);
    const cleanedBasePrep = row.prepNote
      .replace(/,?\s*\bdivided\b/gi, '')
      .replace(/^,\s*/, '')
      .trim();

    matchingStepIndices.forEach((stepIdx, partIdx) => {
      const partQty = partQuantities[partIdx];
      const partLabel = `Part ${partIdx + 1}/${partCount} (Step ${stepIdx + 1})`;
      const combinedPrep = cleanedBasePrep
        ? `${cleanedBasePrep}, ${partLabel}`
        : partLabel;

      result.push({
        ...row,
        id: `${row.id}-part-${partIdx + 1}`,
        quantity: partQty,
        quantityMax: null,
        rawQuantity: partQty !== null ? formatSimpleNumber(partQty) : row.rawQuantity,
        prepNote: combinedPrep,
        isDividedSplit: true,
        dividedPartLabel: partLabel,
        firstUsedStepIndex: stepIdx,
      });
    });
  }

  return result;
}

/**
 * Allocates numeric amounts across divided parts by reading explicit quantities
 * or proportional phrases ("half", "remaining") inside the matched steps,
 * falling back to an equal division when no explicit split ratio is written.
 */
function allocateDividedQuantities(
  row: IngredientRow,
  stepIndices: number[],
  instructions: string[]
): Array<number | null> {
  if (row.quantity === null || row.quantity <= 0) {
    return stepIndices.map(() => null);
  }

  const total = row.quantity;
  const keywords = extractIngredientKeywords(row.name);
  const allocations: Array<number | null> = stepIndices.map(() => null);
  let remainingIdx = -1;

  stepIndices.forEach((stepIdx, idx) => {
    const stepText = normalizeUnicodeFractions(instructions[stepIdx]);

    // Check for explicit fraction or amount right before an ingredient keyword
    for (const kw of keywords) {
      const explicitRegex = new RegExp(
        `((?:\\d+\\s+\\d+\\/\\d+)|(?:\\d+\\/\\d+)|(?:\\d+(?:\\.\\d+)?))\\s*(?:${row.unit || 'cups?|tbsp|tsp|oz|g|lb'})?\\s*(?:of\\s+)?(?:the\\s+)?[^.,;]*\\b${kw}s?\\b`,
        'i'
      );
      const match = stepText.match(explicitRegex);
      if (match) {
        const parsed = parseNumericToken(match[1]);
        if (parsed !== null && parsed > 0 && parsed < total) {
          allocations[idx] = parsed;
          break;
        }
      }
    }

    if (allocations[idx] === null) {
      if (/\bhalf\b/i.test(stepText)) {
        allocations[idx] = Number((total / 2).toFixed(4));
      } else if (/\b(?:remaining|rest)\b/i.test(stepText)) {
        remainingIdx = idx;
      }
    }
  });

  // Resolve "remaining" slot if all other slots are known
  const knownSum = allocations.reduce<number>((sum, val) => sum + (val ?? 0), 0);
  const unknownCount = allocations.filter((val) => val === null).length;

  if (remainingIdx >= 0 && unknownCount === 1 && knownSum < total) {
    allocations[remainingIdx] = Number((total - knownSum).toFixed(4));
  } else if (unknownCount > 0) {
    const leftover = Math.max(0, total - knownSum);
    const evenShare =
      leftover > 0 ? Number((leftover / unknownCount).toFixed(4)) : Number((total / stepIndices.length).toFixed(4));
    for (let i = 0; i < allocations.length; i += 1) {
      if (allocations[i] === null) {
        allocations[i] = evenShare;
      }
    }
  }

  return allocations;
}

/**
 * Formats a clean decimal/fraction string for rawQuantity on split rows.
 */
function formatSimpleNumber(val: number): string {
  const rounded = Math.round(val * 1000) / 1000;
  const fractionPairs: Array<[number, string]> = [
    [0.25, '1/4'],
    [0.333, '1/3'],
    [0.5, '1/2'],
    [0.667, '2/3'],
    [0.75, '3/4'],
    [0.125, '1/8'],
  ];
  const whole = Math.floor(rounded);
  const frac = rounded - whole;
  for (const [target, label] of fractionPairs) {
    if (Math.abs(frac - target) < 0.02) {
      return whole > 0 ? `${whole} ${label}` : label;
    }
  }
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
}

// ============================================================================
// Hardware, Duration & Temperature Extraction
// ============================================================================

/**
 * Scans all instruction steps to extract deduplicated cookware/hardware,
 * critical target temperatures (oven/internal/oil), and per-step parameters.
 *
 * @param instructions - Ordered instruction steps.
 * @returns Consolidated hardware list, critical temps, and per-step metadata.
 */
export function extractHardwareAndTemps(instructions: string[]): {
  hardware: string[];
  criticalTemperatures: string[];
  stepParams: Array<{ duration?: string; temperature?: string; hardware: string[] }>;
} {
  const allHardware = new Set<string>();
  const allTemps = new Set<string>();
  const stepParams: Array<{ duration?: string; temperature?: string; hardware: string[] }> = [];

  for (const step of instructions) {
    const stepHardware = new Set<string>();

    // Scan hardware dictionary; suppress redundant generic match if specific match hit
    for (const entry of HARDWARE_PATTERNS) {
      if (entry.pattern.test(step)) {
        if (entry.label === 'Skillet' && stepHardware.has('Cast-iron skillet')) continue;
        if (entry.label === 'Mixing bowl' && stepHardware.has('Stand mixer')) {
          // Only add Mixing bowl if "bowl" appears separately from stand mixer bowl
          if (!/\bmixing bowl\b/i.test(step)) continue;
        }
        stepHardware.add(entry.label);
        allHardware.add(entry.label);
      }
    }

    // Extract temperatures like "350°F", "180°C", "165 degrees F internal"
    const tempMatches: string[] = [];
    const tempRegex =
      /\b(\d{2,3})\s*(?:°|deg(?:rees?)?\.?\s*)?\s*(F|C|Fahrenheit|Celsius)\b(?:\s*\(?\s*(internal|center|oil|oven)\b)?/gi;
    let tMatch: RegExpExecArray | null = tempRegex.exec(step);
    while (tMatch !== null) {
      const value = tMatch[1];
      const unitChar = tMatch[2].toUpperCase().startsWith('C') ? 'C' : 'F';
      const contextBefore = step.slice(Math.max(0, tMatch.index - 42), tMatch.index);
      const isInternal =
        /\b(?:internal|thermometer|center|reads?|reaches?)\b/i.test(contextBefore) ||
        /\binternal\b/i.test(tMatch[3] || '');
      const formatted = isInternal ? `${value}°${unitChar} (internal)` : `${value}°${unitChar}`;
      tempMatches.push(formatted);
      allTemps.add(formatted);
      tMatch = tempRegex.exec(step);
    }

    // Extract step durations (e.g., "10-12 minutes", "1 hour", "30 sec")
    const durationRegex =
      /\b(\d+(?:\s*(?:-|to|–)\s*\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/gi;
    const dMatches: string[] = [];
    let dMatch: RegExpExecArray | null = durationRegex.exec(step);
    while (dMatch !== null) {
      const range = dMatch[1].replace(/\s*(?:to|–)\s*/i, '-').replace(/\s+/g, '');
      const rawUnit = dMatch[2].toLowerCase();
      const shortUnit = rawUnit.startsWith('h')
        ? 'hr'
        : rawUnit.startsWith('m')
          ? 'min'
          : 'sec';
      dMatches.push(`${range} ${shortUnit}`);
      dMatch = durationRegex.exec(step);
    }

    stepParams.push({
      duration: dMatches.length > 0 ? dMatches.join(' / ') : undefined,
      temperature: tempMatches.length > 0 ? tempMatches.join(', ') : undefined,
      hardware: Array.from(stepHardware),
    });
  }

  return {
    hardware: Array.from(allHardware),
    criticalTemperatures: Array.from(allTemps),
    stepParams,
  };
}

// ============================================================================
// TRN Topological Graph & Spec Builder
// ============================================================================

/**
 * Extracts a crisp uppercase engineering verb from the beginning of a step.
 */
function extractLeadVerb(instruction: string): string {
  // Strip leading component labels like "Make the crust:" or "For the cream:" (keep verb labels like "Bake:")
  const withoutLabel = instruction
    .replace(/^(?:for|make|to make)\s+the\s+[^:]{1,28}:\s*/i, '')
    .trim();
  const target = withoutLabel || instruction;
  const firstWord = target.trim().split(/\s+/)[0]?.replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (firstWord && COOKING_VERBS.includes(firstWord)) {
    return firstWord;
  }

  const firstSentence = target.split(/[.!?]/)[0] || target;
  const prefix = firstSentence.toUpperCase().slice(0, 48);

  let bestVerb = '';
  let bestPos = Infinity;
  for (const verb of COOKING_VERBS) {
    const pos = prefix.search(new RegExp(`\\b${verb}\\b`));
    if (pos !== -1 && pos < bestPos) {
      bestPos = pos;
      bestVerb = verb;
    }
  }
  if (bestVerb) return bestVerb;

  return firstWord && firstWord.length >= 2 ? firstWord : 'PROCESS';
}

/**
 * Generates a concise sub-assembly output label for an action node.
 */
function inferOutputLabel(stepText: string, stepNumber: number, isFinal: boolean): string {
  if (isFinal) return 'FINISHED DISH';
  const lower = stepText.toLowerCase();
  if (/\bpour in the filling\b|\bbake until\b/i.test(lower)) return 'Baked Pie';
  if (/^cool\b|^chill\b/i.test(lower)) return 'Cooled Pie';
  if (/\bfor the cream\b|\bwhip\b.*\bsoft peaks\b|\bcream cheese\b/i.test(lower)) return 'Cream Topping';
  if (/\bmelt\b.*\bbutter\b.*\bspices?\b|\bbloom\b/i.test(lower)) return 'Spiced Butter';
  if (/\bcrust\b|\bcrumb mixture\b|\bgingersnaps?\b/i.test(lower)) {
    return /\bbake\b/i.test(lower) ? 'Baked Crust' : 'Crust Base';
  }
  if (/\bfilling\b|\bpumpkin puree\b.*\bdulce de leche\b|\bcustard\b/i.test(lower)) return 'Filling Mix';
  if (/\bdry ingredients\b|\bflour\b.*\bsalt\b/i.test(lower)) return 'Dry Mix';
  if (/\bcreamed?\b|\bbutter\b.*\bsugar\b/i.test(lower)) return 'Creamed Base';
  if (/\bbatter\b/i.test(lower)) return 'Batter';
  if (/\bdough\b/i.test(lower)) return 'Dough';
  if (/\bsauce\b|\bglaze\b|\breduction\b/i.test(lower)) return 'Sauce Base';
  if (/\bcompound butter\b|\bherb butter\b/i.test(lower)) return 'Herb Butter';
  if (/\bpreheat\b/i.test(lower)) return 'Oven Ready';
  if (/\bwhisk\b|\bbeaten?\b/i.test(lower)) return `Whisked Mix #${stepNumber}`;
  if (/\bsaute\b|\bsauté\b|\bbrown\b|\bsear\b/i.test(lower)) return `Seared/Sautéed #${stepNumber}`;
  return `Sub-Assembly #${stepNumber}`;
}

/**
 * Generates a deterministic short doc identifier from a recipe title.
 */
function createDocNumber(title: string): string {
  let hash = 2166136261;
  for (let i = 0; i < title.length; i += 1) {
    hash ^= title.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).toUpperCase().padStart(6, '0').slice(0, 6);
  return `TRN-${hex}`;
}

/**
 * Compiles an ExtractedRawRecipe into a full Tabular Recipe Notation document
 * using deterministic heuristics, automatic divided-ingredient splitting, and
 * topological contiguous row ordering.
 *
 * @param raw - Intermediate scraped or raw-text recipe payload.
 * @returns Complete TrnRecipeDocument ready for client rendering or AI refinement.
 */
export function buildTrnDocumentHeuristic(raw: ExtractedRawRecipe): TrnRecipeDocument {
  const instructions =
    raw.rawInstructions.length > 0
      ? raw.rawInstructions
      : ['Combine all listed ingredients and cook until done.'];

  // 1. Parse raw ingredient strings into structured rows
  const parsedIngredients = raw.rawIngredients.map((line, idx) =>
    parseIngredientLine(line, idx)
  );

  // 2. Automatically split "divided" ingredients into separate step-pinned rows
  const splitIngredients = splitDividedIngredients(parsedIngredients, instructions);

  // 3. Pin every non-split ingredient to its best/earliest consuming step index,
  //    advancing downstream when the same ingredient appears across multiple components.
  let matchedCount = 0;
  const lastStepByIngredientKey = new Map<string, number>();

  for (const ing of splitIngredients) {
    if (ing.isDividedSplit) {
      matchedCount += 1;
      continue;
    }

    const ingKey = normalizeIngredientKey(ing.name);
    const prevStep = lastStepByIngredientKey.get(ingKey);
    const searchStart = prevStep !== undefined ? prevStep + 1 : 0;

    let foundStep = -1;
    let bestScore = 0;
    for (let s = searchStart; s < instructions.length; s += 1) {
      const score = scoreStepIngredientMatch(instructions[s], ing);
      if (score > bestScore) {
        bestScore = score;
        foundStep = s;
      }
    }

    if (foundStep === -1 && searchStart > 0) {
      for (let s = 0; s < instructions.length; s += 1) {
        const score = scoreStepIngredientMatch(instructions[s], ing);
        if (score > bestScore) {
          bestScore = score;
          foundStep = s;
        }
      }
    }

    if (foundStep >= 0) {
      ing.firstUsedStepIndex = foundStep;
      lastStepByIngredientKey.set(ingKey, foundStep);
      matchedCount += 1;
    } else {
      // Garnish or finishing items attach to the last step; others attach to Step 1
      const isFinishing = /\bgarnish\b|\bserve\b|\btop\b|\boptional\b/i.test(
        `${ing.name} ${ing.prepNote}`
      );
      const lastStepText = instructions[instructions.length - 1] || '';
      if (isFinishing || (instructions.length > 1 && /\bgarnish\b|\bserve\b/i.test(lastStepText))) {
        ing.firstUsedStepIndex = instructions.length - 1;
      } else {
        ing.firstUsedStepIndex = 0;
      }
    }
  }

  // 4. Topological contiguous row ordering: sort by firstUsedStepIndex
  const orderedIngredients = [...splitIngredients].sort((a, b) => {
    if (a.firstUsedStepIndex !== b.firstUsedStepIndex) {
      return a.firstUsedStepIndex - b.firstUsedStepIndex;
    }
    return 0;
  });

  // Fallback synthetic ingredient row if input had 0 ingredients
  if (orderedIngredients.length === 0) {
    orderedIngredients.push({
      id: 'ing-1',
      quantity: null,
      rawQuantity: '-',
      unit: '',
      name: 'Recipe components (add ingredients inline)',
      prepNote: '',
      firstUsedStepIndex: 0,
      completed: false,
    });
  }

  // 5. Extract cookware hardware & critical temperatures
  const { hardware, criticalTemperatures, stepParams } = extractHardwareAndTemps(instructions);

  // 6. Build contiguous TRN action nodes across parallel + converging columns
  const { actions, summaryRows } = buildContiguousTrnGraph(
    orderedIngredients,
    instructions,
    stepParams
  );

  // Compute confidence score (0..1) to decide whether Workers AI fallback helps
  const matchRatio =
    splitIngredients.length > 0 ? matchedCount / splitIngredients.length : 0.3;
  const structureBonus = raw.extractionMethod === 'json-ld' || raw.extractionMethod === 'microdata' ? 0.2 : 0.05;
  const instructionBonus = instructions.length >= 2 ? 0.15 : 0;
  const confidenceScore = Number(
    Math.min(1, Math.max(0.15, matchRatio * 0.65 + structureBonus + instructionBonus)).toFixed(2)
  );

  const nowIso = new Date().toISOString();
  const metadata: RecipeSpecMetadata = {
    docNumber: createDocNumber(raw.title || 'Recipe'),
    revision: 'REV 1.0',
    sourceUrl: raw.sourceUrl,
    prepTime: raw.prepTime,
    cookTime: raw.cookTime,
    totalTime: raw.totalTime,
    baseServings: Math.max(1, raw.servings || 4),
    yieldLabel: raw.yieldLabel || `${Math.max(1, raw.servings || 4)} servings`,
    hardware,
    criticalTemperatures,
    parserEngine: 'heuristic',
    confidenceScore,
    createdAt: nowIso,
  };

  return {
    id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: raw.title || 'Untitled Recipe Spec',
    description: raw.description,
    metadata,
    ingredients: orderedIngredients,
    actions,
    summaryRows,
  };
}

/**
 * Constructs a strictly non-overlapping, gap-free TRN action node graph and
 * matching Row-per-Step summary rows from step-ordered ingredients.
 */
export function buildContiguousTrnGraph(
  orderedIngredients: IngredientRow[],
  instructions: string[],
  stepParams: Array<{ duration?: string; temperature?: string; hardware: string[] }>
): { actions: TrnActionNode[]; summaryRows: TrnStepSummaryRow[] } {
  const totalRows = orderedIngredients.length;

  // Map each step index to the contiguous slice of ingredient rows it introduces
  const stepNewRows = new Map<number, { startRow: number; endRow: number; ids: string[] }>();
  for (let r = 0; r < totalRows; r += 1) {
    const ing = orderedIngredients[r];
    const sIdx = Math.max(0, Math.min(instructions.length - 1, ing.firstUsedStepIndex));
    const existing = stepNewRows.get(sIdx);
    if (!existing) {
      stepNewRows.set(sIdx, { startRow: r, endRow: r, ids: [ing.id] });
    } else {
      existing.endRow = r;
      existing.ids.push(ing.id);
    }
  }

  // Track active unmerged sub-assembly intervals across the grid.
  interface ActiveCluster {
    startRow: number;
    endRow: number;
    node: TrnActionNode;
  }

  let activeClusters: ActiveCluster[] = [];
  const actions: TrnActionNode[] = [];
  const summaryRows: TrnStepSummaryRow[] = [];

  for (let s = 0; s < instructions.length; s += 1) {
    const stepText = instructions[s];
    const params = stepParams[s] || { hardware: [] };
    const newSlice = stepNewRows.get(s);
    const isLastStep = s === instructions.length - 1;

    // Heuristic: determine whether this step starts a parallel prep track
    // ("Meanwhile", "In another bowl", "In a separate pan") or merges upstream tracks.
    const startsParallelBranch =
      Boolean(newSlice) &&
      activeClusters.length > 0 &&
      !isLastStep &&
      /\b(?:meanwhile|in a (?:separate|second|small|large|another) (?:bowl|pan|pot|skillet)|(?:for|make) the (?:sauce|glaze|topping|filling|frosting|cream|crust))\b/i.test(
        stepText
      );

    let mergedClusters: ActiveCluster[] = [];

    if (isLastStep) {
      // Final step converges all remaining active clusters into the finished dish
      mergedClusters = [...activeClusters];
    } else if (!startsParallelBranch && activeClusters.length > 0) {
      // Check if instruction merges everything ("combine", "fold dry into wet", "pour over")
      const mergesAllCue =
        activeClusters.length > 1 &&
        /\b(?:combine|fold|pour|stir in|add the|transfer|mix together|assemble)\b/i.test(stepText);

      if (mergesAllCue) {
        mergedClusters = [...activeClusters];
      } else if (newSlice) {
        // Merge the adjacent cluster immediately preceding the new row slice
        const precedingCluster = activeClusters.find(
          (c) => c.endRow === newSlice.startRow - 1
        );
        if (precedingCluster) {
          mergedClusters = [precedingCluster];
        } else {
          // If no adjacent cluster precedes it, attach to the latest cluster only if contiguous
          const lastCluster = activeClusters[activeClusters.length - 1];
          if (lastCluster && lastCluster.endRow + 1 === newSlice.startRow) {
            mergedClusters = [lastCluster];
          }
        }
      } else {
        // Processing step with no new ingredients (e.g., "Bake for 15 minutes", "Chill 1 hour")
        // Operates on the most recent active cluster (or all if multiple ready)
        if (activeClusters.length > 0) {
          mergedClusters = [activeClusters[activeClusters.length - 1]];
        }
      }
    }

    // Calculate contiguous vertical span [startRow .. endRow]
    const spanStarts: number[] = [];
    const spanEnds: number[] = [];
    if (newSlice) {
      spanStarts.push(newSlice.startRow);
      spanEnds.push(newSlice.endRow);
    }
    for (const mc of mergedClusters) {
      spanStarts.push(mc.startRow);
      spanEnds.push(mc.endRow);
    }

    // If a pure prep step (like "Preheat oven to 350F") happens before any ingredients,
    // bind it across all rows in the final/initial span or row 0 so nothing floats detached.
    let startRow = spanStarts.length > 0 ? Math.min(...spanStarts) : 0;
    let endRow = spanEnds.length > 0 ? Math.max(...spanEnds) : totalRows - 1;

    if (isLastStep) {
      startRow = 0;
      endRow = totalRows - 1;
    }

    // Ensure any unmerged cluster strictly enclosed inside [startRow..endRow] is also absorbed
    // so horizontal/vertical grid lines remain topologically sound and non-overlapping.
    const absorbedClusters = activeClusters.filter(
      (c) =>
        mergedClusters.includes(c) ||
        (c.startRow >= startRow && c.endRow <= endRow)
    );

    if (absorbedClusters.length > 0) {
      startRow = Math.min(startRow, ...absorbedClusters.map((c) => c.startRow));
      endRow = Math.max(endRow, ...absorbedClusters.map((c) => c.endRow));
    }

    // Calculate horizontal columnDepth: 1 deeper than any absorbed upstream node
    // or deeper than any existing node overlapping this row range
    let maxOverlappingDepth = -1;
    for (const existing of actions) {
      if (!(existing.endRow < startRow || existing.startRow > endRow)) {
        maxOverlappingDepth = Math.max(maxOverlappingDepth, existing.columnDepth);
      }
    }
    const columnDepth = Math.max(
      maxOverlappingDepth + 1,
      absorbedClusters.length > 0
        ? Math.max(...absorbedClusters.map((c) => c.node.columnDepth)) + 1
        : 0
    );

    const verb = extractLeadVerb(stepText);
    let outputLabel = inferOutputLabel(stepText, s + 1, isLastStep);
    if (
      outputLabel.startsWith('Sub-Assembly #') &&
      absorbedClusters.length === 1 &&
      absorbedClusters[0].node.outputLabel === 'Crust Base' &&
      /\bbake\b/i.test(stepText)
    ) {
      outputLabel = 'Baked Crust';
    }

    const node: TrnActionNode = {
      id: `act-${s + 1}`,
      stepNumber: s + 1,
      columnDepth,
      startRow,
      endRow,
      ingredientRowIds: newSlice ? newSlice.ids : [],
      inputNodeIds: absorbedClusters.map((c) => c.node.id),
      verb,
      instruction: stepText,
      duration: params.duration,
      temperature: params.temperature,
      hardware: params.hardware,
      outputLabel,
      completed: false,
    };

    actions.push(node);

    // Replace absorbed clusters with this new combined cluster
    activeClusters = activeClusters.filter((c) => !absorbedClusters.includes(c));
    activeClusters.push({ startRow, endRow, node });
    activeClusters.sort((a, b) => a.startRow - b.startRow);

    // Build synchronized Row-per-Step Engineering Summary row
    const directIngRows = (newSlice ? newSlice.ids : [])
      .map((id) => orderedIngredients.find((ing) => ing.id === id))
      .filter((ing): ing is IngredientRow => Boolean(ing));

    const ingredientsSummary =
      directIngRows.length > 0
        ? directIngRows
            .map((ing) =>
              [ing.rawQuantity, ing.unit, ing.name].filter(Boolean).join(' ')
            )
            .join('; ')
        : absorbedClusters.length > 0
          ? `From: ${absorbedClusters.map((c) => c.node.outputLabel).join(' + ')}`
          : 'Equipment / Prep';

    const paramTokens = [
      ...(params.hardware || []),
      params.temperature,
      params.duration,
    ].filter(Boolean);

    summaryRows.push({
      id: node.id,
      stepNumber: node.stepNumber,
      ingredientIds: node.ingredientRowIds,
      ingredientsSummary,
      actionText: stepText,
      parametersText: paramTokens.length > 0 ? paramTokens.join(' | ') : '-',
      outputLabel,
      completed: false,
    });
  }

  return { actions, summaryRows };
}
