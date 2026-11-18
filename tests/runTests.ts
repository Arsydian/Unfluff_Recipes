/**
 * ============================================================================
 * Test Suite Runner Entrypoint
 * ----------------------------------------------------------------------------
 * Imports all test suites and runs them via the zero-dependency harness.
 * ============================================================================
 */

import { runAllTests } from './testHarness';
import './heuristicParser.test';
import './trnMatrix.test';
import './unitConverter.test';
import './workerApi.test';

await runAllTests();
