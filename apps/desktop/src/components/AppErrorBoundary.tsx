import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { readStoredLanguage, resolveLocale } from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Keysmith] Uncaught render error:', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetUi = () => {
    try {
      localStorage.removeItem('keysmith:sidebarWidth');
      localStorage.removeItem('keysmith:listWidth');
    } catch {
      // ignore storage errors
    }
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const isEn = resolveLocale(readStoredLanguage()) === 'en';
    return (
      <div className="h-dvh w-full flex items-center justify-center bg-[var(--bg-sidebar)] p-6">
        <div className="w-full max-w-[400px] rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-xl p-7 text-center flex flex-col items-center">
          <div className="w-11 h-11 rounded-xl bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/25 flex items-center justify-center text-[var(--status-danger)] mb-4">
            <AlertTriangle size={20} />
          </div>
          <h1 className="text-[15px] font-semibold text-[var(--text-primary)]">
            {isEn ? 'Something went wrong' : '界面渲染异常'}
          </h1>
          <div className="mt-4 w-full px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[11px] font-mono-tabular text-[var(--status-danger)] text-left break-all max-h-24 overflow-y-auto">
            {this.state.error.message || (isEn ? 'Unknown error' : '未知错误')}
          </div>
          <div className="mt-5 flex items-center gap-2.5 w-full">
            <button
              type="button"
              onClick={this.handleResetUi}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-primary)] cursor-pointer"
            >
              <RotateCcw size={13} />
              {isEn ? 'Reset UI' : '重置状态'}
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white cursor-pointer"
            >
              <RefreshCw size={13} />
              {isEn ? 'Reload' : '重新加载'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
