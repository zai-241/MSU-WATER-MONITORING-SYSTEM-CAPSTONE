import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled Application Error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
          <div className="bg-card/60 backdrop-blur-md border border-border/60 p-8 rounded-2xl max-w-md w-full shadow-lg space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 border border-danger/20 text-danger">
              <AlertTriangle className="h-7 w-7 animate-pulse" />
            </div>
            
            <div className="space-y-1.5">
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                {this.props.fallbackTitle || 'Unable to load telemetry view'}
              </h2>
              <p className="text-xs text-muted-foreground">
                An unexpected interface rendering issue was detected. The system safeguarded your session data.
              </p>
            </div>

            {this.state.error && (
              <div className="p-3 bg-secondary/30 rounded-lg text-left overflow-x-auto text-[11px] font-mono text-danger/90 border border-danger/10">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={this.handleReset}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary hover:opacity-90 py-2.5 text-xs font-bold text-primary-foreground transition active:scale-95 shadow-sm"
              >
                <RefreshCw size={14} /> Reload Page
              </button>
              <a
                href="/dashboard"
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-border hover:bg-secondary py-2.5 text-xs font-bold text-foreground transition active:scale-95"
              >
                <Home size={14} /> Dashboard
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
