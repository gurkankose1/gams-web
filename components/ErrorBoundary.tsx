import React, { Component, ErrorInfo, ReactNode } from 'react';

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
    console.error("GAMS ErrorBoundary caught an error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-gray-900/90 flex items-center justify-center z-[100] p-6 text-white">
          <div className="bg-gray-800 border border-red-500/50 rounded-xl p-6 max-w-lg w-full text-center space-y-4 shadow-2xl">
            <span className="text-4xl">⚠️</span>
            <h2 className="text-xl font-bold text-red-400">
              {this.props.fallbackTitle || "Bir Arayüz Hatası Oluştu"}
            </h2>
            <p className="text-sm text-gray-300">
              {this.state.error?.message || "Bilinmeyen bir hata meydana geldi."}
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-4 rounded-lg text-sm transition"
              >
                Yeniden Dene
              </button>
              <button
                onClick={() => window.location.reload()}
                className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg text-sm transition"
              >
                Sayfayı Yenile
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
