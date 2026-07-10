import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

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
        credentials: "include",
        headers: {
          "X-Auth-Token":
            typeof window !== "undefined"
              ? localStorage.getItem("opencode_auth_token") || ""
              : "",
        },
      });
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      alert("Не удалось сбросить. Проверьте соединение с сервером.");
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <Card className="w-full max-w-md text-center shadow-xl">
            <CardContent className="space-y-4 pt-8 pb-8">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-semibold">Something went wrong</h2>
              <p className="text-sm text-muted-foreground">{this.state.message}</p>
              <p className="text-xs text-muted-foreground">
                If this happened after a Self-Improvement edit, you can reset the UI
                source code back to factory Git state.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <Button type="button" onClick={this.handleReload}>
                  Try again
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  onClick={this.handleResetUI}
                >
                  🔄 Reset UI to Git
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}
