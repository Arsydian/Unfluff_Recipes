/**
 * ============================================================================
 * Zero-Dependency TypeScript Test Harness
 * ----------------------------------------------------------------------------
 * Replaces heavyweight test runners (and vulnerable transitive dependencies)
 * with a crisp, strict TypeScript assertion, mock, and fake-timer runner
 * executed via `tsx tests/runTests.ts`.
 * ============================================================================
 */

// ============================================================================
// Suite & Test Registration
// ============================================================================

interface TestCase {
  suite: string;
  name: string;
  fn: () => void | Promise<void>;
  afterHooks: Array<() => void | Promise<void>>;
}

const registeredTests: TestCase[] = [];
const suiteStack: Array<{ name: string; afterHooks: Array<() => void | Promise<void>> }> = [];

/**
 * Defines a named test suite grouping related assertions.
 */
export function describe(name: string, fn: () => void): void {
  suiteStack.push({ name, afterHooks: [] });
  try {
    fn();
  } finally {
    suiteStack.pop();
  }
}

/**
 * Registers an individual synchronous or asynchronous test case.
 */
export function it(name: string, fn: () => void | Promise<void>): void {
  const currentSuite = suiteStack[suiteStack.length - 1];
  const suiteLabel = suiteStack.map((s) => s.name).join(' > ') || 'Root';
  const afterHooks = suiteStack.flatMap((s) => [...s.afterHooks]);
  registeredTests.push({
    suite: currentSuite ? suiteLabel : 'Root',
    name,
    fn,
    afterHooks,
  });
}

/**
 * Registers a cleanup hook run after every test in the current `describe` block.
 */
export function afterEach(fn: () => void | Promise<void>): void {
  const currentSuite = suiteStack[suiteStack.length - 1];
  if (currentSuite) {
    currentSuite.afterHooks.push(fn);
  }
}

// ============================================================================
// Mock Functions & Fake Timers (`vi`)
// ============================================================================

export interface MockFunction<TArgs extends unknown[] = unknown[], TReturn = unknown> {
  (...args: TArgs): TReturn;
  mock: { calls: TArgs[] };
  mockResolvedValue(val: Awaited<TReturn>): MockFunction<TArgs, Promise<Awaited<TReturn>>>;
  mockImplementation(impl: (...args: TArgs) => TReturn): MockFunction<TArgs, TReturn>;
}

const realDateNow = Date.now.bind(Date);
let fakeNowMs: number | null = null;

export const vi = {
  /**
   * Creates a spy/mock function recording all invocations.
   */
  fn<TArgs extends unknown[] = unknown[], TReturn = unknown>(
    impl?: (...args: TArgs) => TReturn
  ): MockFunction<TArgs, TReturn> {
    let activeImpl = impl;
    const calls: TArgs[] = [];

    const spy = ((...args: TArgs): TReturn => {
      calls.push(args);
      if (activeImpl) {
        return activeImpl(...args);
      }
      return undefined as TReturn;
    }) as MockFunction<TArgs, TReturn>;

    spy.mock = { calls };
    spy.mockResolvedValue = (val: Awaited<TReturn>) => {
      activeImpl = (() => Promise.resolve(val)) as unknown as (...args: TArgs) => TReturn;
      return spy as unknown as MockFunction<TArgs, Promise<Awaited<TReturn>>>;
    };
    spy.mockImplementation = (nextImpl: (...args: TArgs) => TReturn) => {
      activeImpl = nextImpl;
      return spy;
    };

    return spy;
  },

  /**
   * Overrides `Date.now()` with a deterministic virtual clock.
   */
  useFakeTimers(): void {
    if (fakeNowMs === null) {
      fakeNowMs = realDateNow();
      Date.now = () => (fakeNowMs !== null ? fakeNowMs : realDateNow());
    }
  },

  /**
   * Advances or sets the fake clock timestamp.
   */
  setSystemTime(dateOrMs: Date | number): void {
    fakeNowMs = typeof dateOrMs === 'number' ? dateOrMs : dateOrMs.getTime();
  },

  /**
   * Restores the native `Date.now()` implementation.
   */
  useRealTimers(): void {
    fakeNowMs = null;
    Date.now = realDateNow;
  },
};

// ============================================================================
// Expectation & Deep Matchers (`expect`)
// ============================================================================

const ANY_MARKER = Symbol('expect.any');

interface AnyMatcher {
  [ANY_MARKER]: unknown;
}

function isAnyMatcher(val: unknown): val is AnyMatcher {
  return typeof val === 'object' && val !== null && ANY_MARKER in val;
}

/**
 * Performs structural equality supporting `expect.any(...)` wildcards.
 */
function deepMatch(actual: unknown, expected: unknown): boolean {
  if (isAnyMatcher(expected)) {
    const ctor = expected[ANY_MARKER];
    if (ctor === String) return typeof actual === 'string';
    if (ctor === Number) return typeof actual === 'number';
    if (ctor === Boolean) return typeof actual === 'boolean';
    if (ctor === Object) return typeof actual === 'object' && actual !== null;
    if (typeof ctor === 'function') {
      return actual instanceof (ctor as new (...args: unknown[]) => unknown);
    }
    return true;
  }

  if (Object.is(actual, expected)) return true;

  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return false;
    return actual.every((item, idx) => deepMatch(item, expected[idx]));
  }

  if (
    typeof actual === 'object' &&
    actual !== null &&
    typeof expected === 'object' &&
    expected !== null &&
    !Array.isArray(actual) &&
    !Array.isArray(expected)
  ) {
    const aKeys = Object.keys(actual);
    const eKeys = Object.keys(expected);
    if (aKeys.length !== eKeys.length) return false;
    return eKeys.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(actual, k) &&
        deepMatch(
          (actual as Record<string, unknown>)[k],
          (expected as Record<string, unknown>)[k]
        )
    );
  }

  return false;
}

function makeMatchers(actual: unknown, negated: boolean) {
  const check = (passed: boolean, message: string) => {
    if (negated ? passed : !passed) {
      throw new Error(message);
    }
  };

  return {
    toBe(expected: unknown) {
      check(
        Object.is(actual, expected),
        `Expected ${JSON.stringify(actual)} ${negated ? 'not ' : ''}to be ${JSON.stringify(expected)}`
      );
    },
    toEqual(expected: unknown) {
      check(
        deepMatch(actual, expected),
        `Expected ${JSON.stringify(actual)} ${negated ? 'not ' : ''}to equal ${JSON.stringify(expected)}`
      );
    },
    toBeCloseTo(expected: number, numDigits = 2) {
      const actualNum = Number(actual);
      const tolerance = Math.pow(10, -numDigits) / 2;
      check(
        Number.isFinite(actualNum) && Math.abs(actualNum - expected) < tolerance,
        `Expected ${actual} ${negated ? 'not ' : ''}to be close to ${expected}`
      );
    },
    toBeNull() {
      check(actual === null, `Expected ${JSON.stringify(actual)} ${negated ? 'not ' : ''}to be null`);
    },
    toBeDefined() {
      check(actual !== undefined, `Expected value ${negated ? 'not ' : ''}to be defined`);
    },
    toHaveLength(expectedLength: number) {
      const len = (actual as { length?: number })?.length;
      check(
        len === expectedLength,
        `Expected length ${len} ${negated ? 'not ' : ''}to equal ${expectedLength}`
      );
    },
    toContain(expectedItem: unknown) {
      let found = false;
      if (typeof actual === 'string') {
        found = actual.includes(String(expectedItem));
      } else if (Array.isArray(actual)) {
        found = actual.some((item) => deepMatch(item, expectedItem));
      }
      check(
        found,
        `Expected ${JSON.stringify(actual)} ${negated ? 'not ' : ''}to contain ${JSON.stringify(expectedItem)}`
      );
    },
    toMatch(pattern: RegExp | string) {
      const str = String(actual);
      const matched =
        typeof pattern === 'string' ? str.includes(pattern) : pattern.test(str);
      check(matched, `Expected "${str}" ${negated ? 'not ' : ''}to match ${String(pattern)}`);
    },
    toBeGreaterThanOrEqual(minVal: number) {
      check(
        typeof actual === 'number' && actual >= minVal,
        `Expected ${actual} ${negated ? 'not ' : ''}to be >= ${minVal}`
      );
    },
    toBeLessThanOrEqual(maxVal: number) {
      check(
        typeof actual === 'number' && actual <= maxVal,
        `Expected ${actual} ${negated ? 'not ' : ''}to be <= ${maxVal}`
      );
    },
    toHaveBeenCalledTimes(expectedCount: number) {
      const calls = (actual as MockFunction)?.mock?.calls;
      const count = Array.isArray(calls) ? calls.length : -1;
      check(
        count === expectedCount,
        `Expected mock to have been called ${expectedCount} times, got ${count}`
      );
    },
    toHaveBeenCalledWith(...expectedArgs: unknown[]) {
      const calls = (actual as MockFunction)?.mock?.calls || [];
      const found = calls.some((callArgs) => deepMatch(callArgs, expectedArgs));
      check(
        found,
        `Expected mock ${negated ? 'not ' : ''}to have been called with ${JSON.stringify(expectedArgs)}`
      );
    },
  };
}

export function expect(actual: unknown) {
  return {
    ...makeMatchers(actual, false),
    not: makeMatchers(actual, true),
    rejects: {
      async toThrow(pattern?: RegExp | string): Promise<void> {
        let threw = false;
        let errMessage = '';
        try {
          await actual;
        } catch (err) {
          threw = true;
          errMessage = err instanceof Error ? err.message : String(err);
        }
        if (!threw) {
          throw new Error('Expected promise to reject, but it resolved.');
        }
        if (pattern) {
          const matched =
            typeof pattern === 'string'
              ? errMessage.includes(pattern)
              : pattern.test(errMessage);
          if (!matched) {
            throw new Error(
              `Expected rejection "${errMessage}" to match ${String(pattern)}`
            );
          }
        }
      },
    },
  };
}

expect.any = (ctor: unknown): AnyMatcher => ({ [ANY_MARKER]: ctor });

// ============================================================================
// Suite Executor
// ============================================================================

/**
 * Executes all registered test cases sequentially, running `afterEach` hooks
 * and printing a concise report. Exits with code 1 if any test fails.
 */
export async function runAllTests(): Promise<void> {
  const start = realDateNow();
  let passed = 0;
  let failed = 0;

  for (const testCase of registeredTests) {
    try {
      await testCase.fn();
      passed += 1;
      console.log(`  PASS  [${testCase.suite}] ${testCase.name}`);
    } catch (err) {
      failed += 1;
      console.error(`  FAIL  [${testCase.suite}] ${testCase.name}`);
      console.error(`        ${err instanceof Error ? err.stack || err.message : String(err)}`);
    } finally {
      for (const hook of testCase.afterHooks) {
        await hook();
      }
    }
  }

  const elapsedMs = realDateNow() - start;
  console.log(`\nTests: ${passed} passed, ${failed} failed (${registeredTests.length} total) in ${elapsedMs}ms`);
  if (failed > 0) {
    throw new Error(`${failed} test(s) failed.`);
  }
}
