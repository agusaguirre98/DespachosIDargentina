import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error capturado por ErrorBoundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-red-400">
          <h2 className="text-xl font-semibold mb-2">
            ⚠ Ocurrió un error en esta sección
          </h2>
          <pre className="text-xs whitespace-pre-wrap">
            {String(this.state.error)}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}