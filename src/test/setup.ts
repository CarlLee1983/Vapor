import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// Make navigator.clipboard patchable via Object.assign in tests.
//
// @testing-library/user-event v14 unconditionally calls
//   Object.defineProperty(navigator, 'clipboard', { get: () => stub, configurable: true })
// inside its `setupMain()`, replacing any value we set in beforeEach. We work around this
// by wrapping `window.navigator` in a Proxy whose `defineProperty` trap silently drops the
// getter-based clipboard override from user-event, leaving the test-supplied mock in place.
//
// afterEach restores writability so each test's beforeEach can re-assign via Object.assign.

function resetClipboard() {
  Object.defineProperty(navigator, "clipboard", {
    writable: true,
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
}
resetClipboard();
afterEach(resetClipboard);

// Proxy navigator so that user-event's clipboard getter stub does not overwrite the mock.
const navigatorProxy = new Proxy(navigator, {
  defineProperty(target, prop, descriptor) {
    // Intercept user-event's attempt to install a getter-based clipboard stub.
    if (prop === "clipboard" && typeof descriptor.get === "function") {
      return true; // pretend success; leave the value property intact
    }
    return Reflect.defineProperty(target, prop, descriptor);
  },
});
Object.defineProperty(window, "navigator", {
  value: navigatorProxy,
  writable: true,
  configurable: true,
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
