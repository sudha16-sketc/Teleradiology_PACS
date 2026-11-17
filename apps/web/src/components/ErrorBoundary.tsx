"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { clsx } from "clsx";
import { captureError } from "@/lib/error-report";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Rendered instead of `children` once a descendant has thrown. */
  fallback: (error: Error, reset: () => void) => ReactNode;
  /** Identify the region in the captured report. */
  label?: string;
  /** Change any value to clear a caught error and re-render the children. */
  resetKey?: unknown;
  className?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render, lifecycle and constructor faults in a subtree.
 *
 * A class component because that is the only way React offers to catch a render
 * error, and it is the only place the whole tree can be replaced once one has
 * happened.
 *
 * Two deliberate choices:
 *
 *   - It renders nothing but the fallback. No shell, no header, no providers
 *     that may themselves be the cause. A boundary that tries to be helpful while
 *     broken is a second thing to break.
 *   - `reset` clears the state and forces a re-render. React re-mounts the
 *     children on the next attempt, so a transient fault — a WebView2 paint
 *     hiccup, a momentarily undefined context — recovers without a page reload.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureError({
      error,
      context: `error-boundary${this.props.label ? `:${this.props.label}` : ""}`,
      // `componentStack` names components, not data, so it is safe and it is
      // usually the fastest way to locate the fault.
      ...(info.componentStack ? { source: info.componentStack } : {}),
    });
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    // Navigating away from a broken screen should clear the error, otherwise the
    // user is left staring at the fallback after the problem has moved on.
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className={clsx("h-full w-full", this.props.className)}>
          {this.props.fallback(this.state.error, this.reset)}
        </div>
      );
    }
    return this.props.children;
  }
}
