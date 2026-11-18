/**
 * ============================================================================
 * Built-In Reference Demo Recipes
 * ----------------------------------------------------------------------------
 * Three curated sample recipes compiled through the live TRN heuristic parser
 * so users can explore Nested Dependency Grids, Divided Ingredient Splitting,
 * Hardware/Temp Spec Blocks, and Metric/Imperial conversions in one click.
 * ============================================================================
 */

import type { ExtractedRawRecipe, TrnRecipeDocument } from '../../shared/types';
import { buildTrnDocumentHeuristic } from '../../worker/heuristicParser';

export interface SampleRecipePreset {
  id: string;
  label: string;
  tag: string;
  rawText: string;
  rawRecipe: ExtractedRawRecipe;
}

export const SAMPLE_RECIPES: SampleRecipePreset[] = [
  {
    id: 'brown-butter-cookies',
    label: 'Brown Butter Chocolate Chip Cookies',
    tag: 'Divided Ingredients + Parallel Bowls',
    rawText: `Brown Butter Chocolate Chip Cookies
Prep Time: 20 min
Cook Time: 12 min
Total Time: 32 min
Yield: 24 cookies

Ingredients:
- 1 cup unsalted butter
- 2 1/4 cups all-purpose flour
- 1 tsp baking soda
- 1 tsp kosher salt, divided
- 3/4 cup dark brown sugar, packed
- 1/2 cup granulated sugar
- 2 large eggs
- 2 tsp pure vanilla extract
- 1 1/2 cups dark chocolate chips

Instructions:
1. Melt the unsalted butter in a saucepan over medium heat, stirring until golden brown and nutty, 5 minutes, then pour into a mixing bowl to cool slightly.
2. Meanwhile, in a separate bowl, whisk together the all-purpose flour, baking soda, and 1/2 tsp kosher salt.
3. Add the brown sugar and granulated sugar to the cooled brown butter and beat with a whisk until smooth, then beat in eggs and vanilla extract until glossy.
4. Fold the dry ingredients into the butter mixture until just combined, then stir in the dark chocolate chips.
5. Scoop onto a parchment paper lined baking sheet, sprinkle with the remaining 1/2 tsp kosher salt, and bake in a 375°F oven for 10-12 minutes until edges are golden; cool on a wire cooling rack.`,
    rawRecipe: {
      title: 'Brown Butter Chocolate Chip Cookies',
      description: 'Nutty browned butter dough with split flaky salt finishing.',
      prepTime: '20 min',
      cookTime: '12 min',
      totalTime: '32 min',
      servings: 24,
      yieldLabel: '24 cookies',
      extractionMethod: 'raw-text',
      rawIngredients: [
        '1 cup unsalted butter',
        '2 1/4 cups all-purpose flour',
        '1 tsp baking soda',
        '1 tsp kosher salt, divided',
        '3/4 cup dark brown sugar, packed',
        '1/2 cup granulated sugar',
        '2 large eggs',
        '2 tsp pure vanilla extract',
        '1 1/2 cups dark chocolate chips',
      ],
      rawInstructions: [
        'Melt the unsalted butter in a saucepan over medium heat, stirring until golden brown and nutty, 5 minutes, then pour into a mixing bowl to cool slightly.',
        'Meanwhile, in a separate bowl, whisk together the all-purpose flour, baking soda, and 1/2 tsp kosher salt.',
        'Add the brown sugar and granulated sugar to the cooled brown butter and beat with a whisk until smooth, then beat in eggs and vanilla extract until glossy.',
        'Fold the dry ingredients into the butter mixture until just combined, then stir in the dark chocolate chips.',
        'Scoop onto a parchment paper lined baking sheet, sprinkle with the remaining 1/2 tsp kosher salt, and bake in a 375°F oven for 10-12 minutes until edges are golden; cool on a wire cooling rack.',
      ],
    },
  },
  {
    id: 'pan-seared-ribeye',
    label: 'Cast-Iron Ribeye + Garlic Herb Butter',
    tag: 'Parallel Sub-Assembly + Internal Temp',
    rawText: `Cast-Iron Ribeye with Garlic Herb Butter
Prep Time: 10 min
Cook Time: 10 min
Total Time: 25 min
Yield: 2 servings

Ingredients:
- 4 tbsp unsalted butter, softened
- 2 cloves garlic, minced
- 1 tbsp fresh thyme leaves, chopped
- 2 lb bone-in ribeye steak
- 1 tbsp kosher salt
- 1 tsp black pepper
- 1 tbsp canola oil

Instructions:
1. Mash softened unsalted butter, minced garlic, and chopped thyme in a small mixing bowl to make garlic herb butter.
2. Meanwhile, pat the ribeye dry and season all sides evenly with kosher salt and black pepper.
3. Heat canola oil in a cast-iron skillet until smoking hot (450°F surface), sear steak for 3 minutes per side until crusted and internal temperature reaches 130°F on an instant-read thermometer.
4. Top the steak with the garlic herb butter, rest 5 minutes on a cutting board, and serve.`,
    rawRecipe: {
      title: 'Cast-Iron Ribeye with Garlic Herb Butter',
      description: 'High-heat Maillard sear paired with parallel compound butter.',
      prepTime: '10 min',
      cookTime: '10 min',
      totalTime: '25 min',
      servings: 2,
      yieldLabel: '2 servings',
      extractionMethod: 'raw-text',
      rawIngredients: [
        '4 tbsp unsalted butter, softened',
        '2 cloves garlic, minced',
        '1 tbsp fresh thyme leaves, chopped',
        '2 lb bone-in ribeye steak',
        '1 tbsp kosher salt',
        '1 tsp black pepper',
        '1 tbsp canola oil',
      ],
      rawInstructions: [
        'Mash softened unsalted butter, minced garlic, and chopped thyme in a small mixing bowl to make garlic herb butter.',
        'Meanwhile, pat the ribeye dry and season all sides evenly with kosher salt and black pepper.',
        'Heat canola oil in a cast-iron skillet until smoking hot (450°F surface), sear steak for 3 minutes per side until crusted and internal temperature reaches 130°F on an instant-read thermometer.',
        'Top the steak with the garlic herb butter, rest 5 minutes on a cutting board, and serve.',
      ],
    },
  },
  {
    id: 'buttermilk-pancakes',
    label: 'Classic Buttermilk Pancakes',
    tag: 'Dry / Wet Bowl Merge',
    rawText: `Classic Buttermilk Pancakes
Prep Time: 10 min
Cook Time: 15 min
Total Time: 25 min
Yield: 12 pancakes

Ingredients:
- 2 cups all-purpose flour
- 2 tbsp granulated sugar
- 2 tsp baking powder
- 1 tsp baking soda
- 1/2 tsp kosher salt
- 2 cups buttermilk
- 2 large eggs
- 4 tbsp unsalted butter, melted

Instructions:
1. Whisk together the all-purpose flour, granulated sugar, baking powder, baking soda, and kosher salt in a large mixing bowl.
2. Meanwhile, in a separate bowl, whisk the buttermilk and eggs until uniform, then stir in the melted unsalted butter.
3. Pour wet ingredients into dry ingredients and stir gently with a spatula until just moistened (leave small lumps).
4. Cook 1/4-cup portions on a 350°F lightly greased skillet for 2-3 minutes per side until golden and fluffy; serve hot.`,
    rawRecipe: {
      title: 'Classic Buttermilk Pancakes',
      description: 'Parallel dry/wet aeration pipeline for tender griddle pancakes.',
      prepTime: '10 min',
      cookTime: '15 min',
      totalTime: '25 min',
      servings: 12,
      yieldLabel: '12 pancakes',
      extractionMethod: 'raw-text',
      rawIngredients: [
        '2 cups all-purpose flour',
        '2 tbsp granulated sugar',
        '2 tsp baking powder',
        '1 tsp baking soda',
        '1/2 tsp kosher salt',
        '2 cups buttermilk',
        '2 large eggs',
        '4 tbsp unsalted butter, melted',
      ],
      rawInstructions: [
        'Whisk together the all-purpose flour, granulated sugar, baking powder, baking soda, and kosher salt in a large mixing bowl.',
        'Meanwhile, in a separate bowl, whisk the buttermilk and eggs until uniform, then stir in the melted unsalted butter.',
        'Pour wet ingredients into dry ingredients and stir gently with a spatula until just moistened (leave small lumps).',
        'Cook 1/4-cup portions on a 350°F lightly greased skillet for 2-3 minutes per side until golden and fluffy; serve hot.',
      ],
    },
  },
];

/**
 * Compiles one of the built-in preset recipes on demand.
 */
export function loadSamplePresetDocument(presetId: string): TrnRecipeDocument {
  const preset =
    SAMPLE_RECIPES.find((p) => p.id === presetId) || SAMPLE_RECIPES[0];
  return buildTrnDocumentHeuristic(preset.rawRecipe);
}
