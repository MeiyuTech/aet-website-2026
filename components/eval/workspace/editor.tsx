"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { Save, Upload, X, CheckCircle2 } from "lucide-react";
import type { SampleData } from "@/lib/eval/domain/report";
import { Brand, BackLink } from "@/components/eval/ui/navigation";
import { dateLabel } from "@/lib/eval/domain/format";
import { ReportForm } from "../panels/fields-panel";
import { ReportCanvas } from "../report/report-canvas";
import { Assistant } from "../panels/assistant-panel";
import { HistoryPanel } from "../panels/history-panel";
import { WorkflowPanel } from "../panels/workflow-panel";
import { PdfImportDialog } from "../imports/pdf-import-dialog";
import {
  WorkspaceToolbar,
  type WorkspaceMode,
  type WorkspacePanel,
} from "./toolbar";
import { useReportDraft } from "./use-report-draft";
const tabs = [
  ["details", "Applicant"],
  ["credentials", "Credentials"],
  ["documents", "Documents"],
  ["notes", "Notes & signatures"],
] as const;
export function EvalEditor({ reportId }: { reportId: string }) {
  const router = useRouter();
  const {
    record,
    setRecord,
    data,
    name,
    setName,
    id,
    busy,
    setBusy,
    error,
    setError,
    notice,
    setNotice,
    dirty,
    load,
    save,
    exportDocx,
    change: updateDraft,
  } = useReportDraft(reportId);
  const [tab, setTab] = useState("details");
  const [panel, setPanel] = useState<WorkspacePanel>(null);
  const [mode, setMode] = useState<WorkspaceMode>("edit");
  const [assistantOpened, setAssistantOpened] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const printPreviousMode = useRef<"edit" | "preview" | null>(null);

  const onPreviewReady = useCallback(() => setPreviewReady(true), []);
  useEffect(() => {
    const before = () => {
      printPreviousMode.current = mode;
      flushSync(() => setMode("preview"));
    };
    const after = () => {
      if (printPreviousMode.current) setMode(printPreviousMode.current);
      printPreviousMode.current = null;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [mode]);
  function change(value: SampleData) {
    updateDraft(value);
    setPreviewReady(false);
    setNotice("");
  }
  function back() {
    if (busy) return;
    if (!dirty || confirm("Leave this report and discard unsaved changes?"))
      router.push("/admin/eval");
  }
  return (
    <div className="eval-editor">
      <header className="eval-editor-header no-print">
        <Brand onNavigate={back} />
        <BackLink onClick={back} />
        <span className="eval-header-caption">Evaluation workspace</span>
      </header>
      <main>
        <div className="eval-editor-title no-print">
          <div>
            <p className="eval-eyebrow">
              {record ? "REPORT WORKSPACE" : "NEW EVALUATION"}
            </p>
            <label className="eval-sr-only" htmlFor="eval-name">
              Report name
            </label>
            <input
              id="eval-name"
              className="eval-title-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNotice("");
              }}
              disabled={!!busy}
              maxLength={160}
            />
            <p className="eval-save-status">
              {busy ||
                (dirty
                  ? "Unsaved changes"
                  : record
                    ? `Saved ${dateLabel(record.updated_at)}`
                    : "New draft · not saved")}
            </p>
          </div>
          <div className="eval-editor-actions">
            <button
              className="eval-button"
              disabled={!!busy || !data}
              onClick={() => {
                setPanel("workflow");
              }}
            >
              <Upload size={17} />
              Materials & review
            </button>
            <button
              className="eval-button primary"
              disabled={!!busy || !data || !name.trim() || (!dirty && !!record)}
              onClick={save}
            >
              <Save size={17} />
              Save report
            </button>
          </div>
        </div>
        {error && (
          <div className="eval-alert no-print" role="alert">
            {error}
            {!data && <button onClick={load}>Retry</button>}
          </div>
        )}
        {notice && (
          <div className="eval-notice no-print" role="status">
            <CheckCircle2 size={17} />
            {notice}
          </div>
        )}
        {busy && (
          <div className="eval-progress no-print" role="status">
            {busy}
          </div>
        )}
        {!data ? (
          <div className="eval-empty">
            {error ? "Report unavailable" : "Loading report…"}
          </div>
        ) : (
          <>
            <WorkspaceToolbar
              mode={mode}
              panel={panel}
              busy={busy}
              previewReady={previewReady}
              setMode={setMode}
              setPanel={setPanel}
              setPreviewReady={setPreviewReady}
              setAssistantOpened={setAssistantOpened}
              exportDocx={exportDocx}
            />
            <div className={`eval-editor-body ${panel ? "with-panel" : ""}`}>
              <div className="eval-edit-panel">
                <div className="eval-draft-print-label">
                  DRAFT · For review only. Approved documents are downloaded
                  from Materials &amp; review.
                </div>
                <div className="eval-canvas-caption no-print">
                  <span>
                    {mode === "edit"
                      ? "Click any report field to edit"
                      : "Print preview · editing is paused"}
                  </span>
                  <span>
                    US Letter ·{" "}
                    {mode === "edit" ? "Live draft" : "Ready for review"}
                  </span>
                </div>
                <fieldset
                  className="eval-form-fieldset"
                  disabled={!!busy}
                  aria-label="Report document"
                >
                  <ReportCanvas
                    key={mode}
                    data={data}
                    readOnly={mode === "preview"}
                    onChange={change}
                    onReady={onPreviewReady}
                  />
                </fieldset>
              </div>
              <aside
                id="eval-side-panel"
                className="eval-side-panel no-print"
                hidden={!panel}
                aria-label="Report tools"
              >
                <div className="eval-panel-heading">
                  <strong>
                    {panel === "workflow"
                      ? "Materials & review"
                      : panel === "fields"
                        ? "Report fields"
                        : panel === "ai"
                          ? "AI assistant"
                          : "Version history"}
                  </strong>
                  <button
                    className="eval-icon-button"
                    aria-label="Collapse side panel"
                    disabled={!!busy}
                    onClick={() => setPanel(null)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <WorkflowPanel
                  record={record}
                  data={data}
                  dirty={dirty}
                  busy={busy}
                  setBusy={setBusy}
                  active={panel === "workflow"}
                  onLoad={load}
                />
                <div hidden={panel !== "fields"}>
                  <button
                    className="eval-button"
                    disabled={!!busy}
                    onClick={() => setImportOpen(true)}
                  >
                    Legacy PDF import
                  </button>
                  <label className="eval-panel-section-picker">
                    Section
                    <select
                      aria-label="Field section"
                      value={tab}
                      disabled={!!busy}
                      onChange={(event) => setTab(event.target.value)}
                    >
                      {tabs.map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset
                    className="eval-form-fieldset"
                    disabled={!!busy || mode === "preview"}
                  >
                    <ReportForm data={data} onChange={change} section={tab} />
                  </fieldset>
                  {mode === "preview" && (
                    <p className="eval-panel-hint">
                      Choose Edit report to update fields.
                    </p>
                  )}
                </div>
                <HistoryPanel
                  active={panel === "history"}
                  record={record}
                  id={id}
                  busy={busy}
                  dirty={dirty}
                  setBusy={setBusy}
                  setError={setError}
                  setNotice={setNotice}
                  setRecord={setRecord}
                  onRestore={(value) => {
                    change(value);
                    setMode("edit");
                  }}
                />
                <div hidden={panel !== "ai"}>
                  {assistantOpened && (
                    <Assistant
                      id={id}
                      data={data}
                      saved={!!record}
                      busy={busy}
                      setBusy={setBusy}
                      onApply={(value) => {
                        change(value);
                        setMode("edit");
                      }}
                      onClose={() => setPanel(null)}
                    />
                  )}
                </div>
              </aside>
            </div>
          </>
        )}
      </main>
      <PdfImportDialog
        open={importOpen}
        data={data}
        busy={busy}
        error={error}
        setBusy={setBusy}
        setError={setError}
        onClose={() => setImportOpen(false)}
        onApply={(value) => {
          change(value);
          setTab("credentials");
          setPanel("fields");
          setMode("edit");
          setNotice("Imported into your draft. Review the fields, then save.");
        }}
      />
    </div>
  );
}
