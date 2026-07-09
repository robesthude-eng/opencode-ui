/**
 * Tests for src/components/SettingsPanel.tsx
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SettingsPanel from "../components/SettingsPanel";
import { useStore } from "../store/useStore";

// Mock the store
jest.mock("../store/useStore");

// Mock fetch
global.fetch = jest.fn();

describe("SettingsPanel", () => {
  const mockSetOpen = jest.fn();
  const mockLoadAuth = jest.fn();
  const mockSaveKey = jest.fn();
  const mockRemoveKey = jest.fn();
  const mockSetSelfImproveEnabled = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    
    (useStore as unknown as jest.Mock).mockReturnValue({
      settingsOpen: true,
      setOpen: mockSetOpen,
      authed: {},
      loadAuth: mockLoadAuth,
      saveKey: mockSaveKey,
      removeKey: mockRemoveKey,
      selfImproveEnabled: false,
      setSelfImproveEnabled: mockSetSelfImproveEnabled,
    });
  });

  test("renders settings panel when open", () => {
    render(<SettingsPanel />);
    
    expect(screen.getByText("Настройки")).toBeInTheDocument();
    expect(screen.getByText("Саморазвитие")).toBeInTheDocument();
    expect(screen.getByText("OpenCode Zen")).toBeInTheDocument();
    expect(screen.getByText("API Провайдеры")).toBeInTheDocument();
  });

  test("does not render when closed", () => {
    (useStore as unknown as jest.Mock).mockReturnValue({
      settingsOpen: false,
      setOpen: mockSetOpen,
      authed: {},
      loadAuth: mockLoadAuth,
      saveKey: mockSaveKey,
      removeKey: mockRemoveKey,
      selfImproveEnabled: false,
      setSelfImproveEnabled: mockSetSelfImproveEnabled,
    });

    render(<SettingsPanel />);
    
    expect(screen.queryByText("Настройки")).not.toBeInTheDocument();
  });

  test("closes panel when clicking close button", () => {
    render(<SettingsPanel />);
    
    fireEvent.click(screen.getByTitle("Close"));
    
    expect(mockSetOpen).toHaveBeenCalledWith(false);
  });

  test("closes panel when clicking overlay", () => {
    render(<SettingsPanel />);
    
    fireEvent.click(screen.getByText("Настройки").closest(".overlay")!);
    
    expect(mockSetOpen).toHaveBeenCalledWith(false);
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
    (useStore as unknown as jest.Mock).mockReturnValue({
      settingsOpen: true,
      setOpen: mockSetOpen,
      authed: {},
      loadAuth: mockLoadAuth,
      saveKey: mockSaveKey,
      removeKey: mockRemoveKey,
      selfImproveEnabled: true,
      setSelfImproveEnabled: mockSetSelfImproveEnabled,
    });

    render(<SettingsPanel />);
    
    expect(screen.getByText("● Включено")).toBeInTheDocument();
  });

  test("toggles self-improvement mode", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
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
    (useStore as unknown as jest.Mock).mockReturnValue({
      settingsOpen: true,
      setOpen: mockSetOpen,
      authed: {},
      loadAuth: mockLoadAuth,
      saveKey: mockSaveKey,
      removeKey: mockRemoveKey,
      selfImproveEnabled: true,
      setSelfImproveEnabled: mockSetSelfImproveEnabled,
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]), // checkpoints list
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "success", commit: "abc123" }),
      });

    render(<SettingsPanel />);
    
    fireEvent.click(screen.getByText("📸 Создать чекпоинт"));
    
    await waitFor(() => {
      expect(screen.getByText("✔ abc123")).toBeInTheDocument();
    });
  });

  test("loads auth on open", () => {
    render(<SettingsPanel />);
    
    expect(mockLoadAuth).toHaveBeenCalled();
  });

  test("loads checkpoints on open", () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    render(<SettingsPanel />);
    
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/git/checkpoints",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Auth-Token": expect.any(String),
        }),
      })
    );
  });
});
