import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  message: string;
}

/**
 * Catches render-time errors so a crash in one component (e.g. Workspace
 * receiving unexpected data) shows a friendly message instead of a blank
 * white screen. The user can click "Reload" to reset.
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  handleReload = () => {
    this.setState({ hasError: false, message: "" });
  };

  handleResetUI = async () => {
    if (!confirm("Сбросить весь код интерфейса к исходной версии из Git?")) return;
    try {
      await fetch("/api/reset-ui", {
        method: "POST",
        headers: { "X-Auth-Token": typeof window !== "undefined" ? localStorage.getItem("opencode_auth_token") || "" : "" },
      });
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      alert("Не удалось сбросить. Проверьте соединение с сервером.");
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">⚠</div>
            <h2>Something went wrong</h2>
            <p className="muted">{this.state.message}</p>
            <p className="muted small">
              If this happened after a Self-Improvement edit, you can reset the UI source code back to factory Git state.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn-primary" onClick={this.handleReload} type="button">
                Try again
              </button>
              <button className="btn-ghost" style={{ color: "var(--red)", borderColor: "var(--red)" }} onClick={this.handleResetUI} type="button">
                🔄 Reset UI to Git
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
