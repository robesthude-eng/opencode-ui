/**
 * Tests for src/components/SettingsPanel.tsx
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SettingsPanel from "../components/SettingsPanel";
import { useStore } from "../store/useStore";

// Mock the store module; the component reads state via selectors
// (useStore((s) => s.x)), so the mock must APPLY the selector.
vi.mock("../store/useStore");

const mockSetSettingsOpen = vi.fn();
const mockLoadAuth = vi.fn();
const mockLoadCheckpoints = vi.fn();
const mockSaveKey = vi.fn();
const mockRemoveKey = vi.fn();
const mockSetSelfImproveEnabled = vi.fn();

let mockState: Record<string, unknown>;

function setState(overrides: Record<string, unknown> = {}) {
  mockState = {
    settingsOpen: true,
    setSettingsOpen: mockSetSettingsOpen,
    authed: {},
    loadAuth: mockLoadAuth,
    loadCheckpoints: mockLoadCheckpoints,
    saveKey: mockSaveKey,
    removeKey: mockRemoveKey,
    selfImproveEnabled: false,
    setSelfImproveEnabled: mockSetSelfImproveEnabled,
    currentUser: { role: "admin", email: "admin@example.com" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setState();
  
  // URL-aware resilient fetch mock
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/git/checkpoints")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url.includes("/api/git/audit-logs")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(["[Test Log] Action occurred"]) });
    }
    if (url.includes("/api/git/checkpoint")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "success", commit: "abc123" }) });
    }
    if (url.includes("/api/settings/self-improve")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "success" }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector?: (s: typeof mockState) => unknown) =>
      selector ? selector(mockState as any) : mockState,
  );
});

describe("SettingsPanel", () => {
  test("renders settings panel when open", () => {
    render(<SettingsPanel />);
    expect(screen.getByText("Настройки")).toBeInTheDocument();
    expect(screen.getByText("Саморазвитие")).toBeInTheDocument();
    expect(screen.getByText("OpenCode Zen")).toBeInTheDocument();
    expect(screen.getByText("API Провайдеры")).toBeInTheDocument();
  });

  test("does not render when closed", () => {
    setState({ settingsOpen: false });
    render(<SettingsPanel />);
    expect(screen.queryByText("Настройки")).not.toBeInTheDocument();
  });

  test("closes panel when clicking close button", () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByTitle("Close"));
    expect(mockSetSettingsOpen).toHaveBeenCalledWith(false);
  });

  test("closes panel when clicking overlay", () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByText("Настройки").closest(".overlay")!);
    expect(mockSetSettingsOpen).toHaveBeenCalledWith(false);
  });

  test("switches between tabs", () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByText("OpenCode Zen"));
    expect(screen.getByText("Free Models")).toBeInTheDocument();
    fireEvent.click(screen.getByText("API Провайдеры"));
    expect(screen.getByText("Bring your own API key")).toBeInTheDocument();
  });

  test("displays self-improvement toggle", () => {
    render(<SettingsPanel />);
    expect(screen.getByText("○ Выключено")).toBeInTheDocument();
  });

  test("displays self-improvement toggle as enabled", () => {
    setState({ selfImproveEnabled: true });
    render(<SettingsPanel />);
    expect(screen.getByText("● Включено")).toBeInTheDocument();
  });

  test("toggles self-improvement mode", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: "success" }),
    });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByText("○ Выключено"));
    await waitFor(() => {
      expect(mockSetSelfImproveEnabled).toHaveBeenCalledWith(true);
    });
  });

  test("creates checkpoint when button clicked", async () => {
    setState({ selfImproveEnabled: true });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Создать чекпоинт/i }));
    await waitFor(() => {
      expect(screen.getByText("✔ abc123")).toBeInTheDocument();
    });
  });

  test("loads auth on open", () => {
    render(<SettingsPanel />);
    expect(mockLoadAuth).toHaveBeenCalled();
  });

  test("loads checkpoints on open", () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });
    render(<SettingsPanel />);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/git/checkpoints",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Auth-Token": expect.any(String) }),
      }),
    );
  });
});
