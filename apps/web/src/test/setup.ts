import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return {
    bottom: 600,
    height: 600,
    left: 0,
    right: 1000,
    toJSON: () => ({}),
    top: 0,
    width: 1000,
    x: 0,
    y: 0,
  } as DOMRect;
};

class ResizeObserverStub implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    const rect = {
      bottom: 600,
      height: 600,
      left: 0,
      right: 1000,
      toJSON: () => ({}),
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
    } as DOMRectReadOnly;
    this.callback(
      [{ contentRect: rect, target } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}

  disconnect() {}
}

globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverStub;

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0) as unknown as number) as typeof requestAnimationFrame;
}

if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = ((handle: number) =>
    clearTimeout(handle)) as typeof cancelAnimationFrame;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
