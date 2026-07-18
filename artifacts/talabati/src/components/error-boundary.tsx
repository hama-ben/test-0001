import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary] Caught error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 text-center" dir="rtl">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-black text-slate-800 dark:text-white mb-2">حدث خطأ غير متوقع</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 max-w-xs leading-relaxed">
            تعذّر تحميل هذه الصفحة. يرجى إعادة تحميل التطبيق.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 rounded-2xl bg-sky-500 text-white font-bold text-sm shadow-md shadow-sky-400/30 hover:bg-sky-600 transition-colors"
          >
            إعادة التحميل
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
