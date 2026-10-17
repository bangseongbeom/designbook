"use client";

import { Component, ReactNode } from "react";

/** Renders a component preview, showing the error instead if it throws on the client. */
export function DesignbookPreview({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    // `not-prose` disables `prose` inside the preview.
    // `contain-paint` keeps absolute/fixed elements inside the frame.
    <div className="not-prose flex min-h-32 items-center justify-center rounded-xl border bg-fd-card p-6 text-fd-card-foreground contain-paint">
      <PreviewErrorBoundary>{children}</PreviewErrorBoundary>
    </div>
  );
}

class PreviewErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override render(): ReactNode {
    if (this.state.error)
      return (
        <p className="text-sm text-fd-muted-foreground">
          Preview unavailable: {this.state.error.message}
        </p>
      );
    return this.props.children;
  }
}
