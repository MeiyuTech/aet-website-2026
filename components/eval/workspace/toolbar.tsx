"use client";
import {
  Download,
  Printer,
  Eye,
  PencilLine,
  PanelRight,
  Sparkles,
  History,
} from "lucide-react";
export type WorkspacePanel = "fields" | "ai" | "history" | null;
export type WorkspaceMode = "edit" | "preview";
type Props = {
  mode: WorkspaceMode;
  panel: WorkspacePanel;
  busy: string;
  previewReady: boolean;
  setMode: (mode: WorkspaceMode) => void;
  setPanel: (panel: WorkspacePanel) => void;
  setPreviewReady: (ready: boolean) => void;
  setAssistantOpened: (opened: boolean) => void;
  exportDocx: () => void;
};
export function WorkspaceToolbar({
  mode,
  panel,
  busy,
  previewReady,
  setMode,
  setPanel,
  setPreviewReady,
  setAssistantOpened,
  exportDocx,
}: Props) {
  return (
    <div className="eval-editor-tools no-print">
      <nav aria-label="Report view">
        <button
          className={mode === "edit" ? "active" : ""}
          aria-pressed={mode === "edit"}
          disabled={!!busy}
          onClick={() => {
            setMode("edit");
            setPreviewReady(false);
          }}
        >
          <PencilLine size={16} /> Edit report
        </button>
        <button
          className={mode === "preview" ? "active" : ""}
          aria-pressed={mode === "preview"}
          disabled={!!busy}
          onClick={() => {
            if (mode !== "preview") {
              setMode("preview");
              setPreviewReady(false);
            }
          }}
        >
          <Eye size={16} /> Print preview
        </button>
      </nav>
      <div>
        <button
          className="eval-tool-button"
          onClick={exportDocx}
          disabled={!!busy}
        >
          <Download size={16} /> Word
        </button>
        <button
          className="eval-tool-button"
          disabled={!!busy || (mode === "preview" && !previewReady)}
          onClick={() => {
            if (mode !== "preview") {
              setMode("preview");
              setPreviewReady(false);
            } else window.print();
          }}
        >
          <Printer size={16} />
          {mode === "preview" ? "Print / PDF" : "Preview & print"}
        </button>
        <span className="eval-tool-divider" aria-hidden="true" />
        {(
          [
            ["fields", "Fields", PanelRight],
            ["ai", "AI assistant", Sparkles],
            ["history", "History", History],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            className={`eval-tool-button ${panel === key ? "selected" : ""}`}
            aria-expanded={panel === key}
            aria-controls="eval-side-panel"
            disabled={!!busy}
            onClick={() => {
              setPanel(panel === key ? null : key);
              if (key === "ai") setAssistantOpened(true);
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
