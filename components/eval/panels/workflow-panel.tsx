"use client";
import { useEffect, useRef, useState } from "react";
import { Upload, FileCheck2 } from "lucide-react";
import { evalRequest } from "@/lib/eval/client/api";
import {
  draftDifferences,
  differenceRows,
  reportSectionLabels,
  type WorkflowState,
} from "@/lib/eval/domain/generation";
import type { SavedReport } from "@/lib/eval/domain/records";
import { requiredReviewFields } from "@/lib/eval/templates/course-by-course";
import type { SampleData } from "@/lib/eval/domain/report";
type Props = {
  record: SavedReport | null;
  data: SampleData;
  dirty: boolean;
  busy: string;
  active: boolean;
  setBusy: (value: string) => void;
  onLoad: () => Promise<void>;
};
export function WorkflowPanel({
  record,
  data,
  dirty,
  busy,
  active,
  setBusy,
  onLoad,
}: Props) {
  const [state, setState] = useState<WorkflowState | null>(null),
    [error, setError] = useState(""),
    [working, setWorking] = useState("");
  const [complete, setComplete] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [reviewer, setReviewer] = useState(""),
    [notes, setNotes] = useState(""),
    [ack, setAck] = useState<string[]>([]);
  const [differenceReview, setDifferenceReview] = useState(false),
    [downloadError, setDownloadError] = useState("");
  const latest = useRef({ dirty, onLoad, record });
  latest.current = { dirty, onLoad, record };
  const refreshing = useRef(false),
    loaded = useRef<string | null>(null);
  const run = state?.runs[0],
    running = run?.status === "queued" || run?.status === "running";
  const disabled = !!working || !!busy;
  async function refresh() {
    if (!record || refreshing.current) return;
    refreshing.current = true;
    try {
      const next = await evalRequest<WorkflowState>(`workflow/${record.id}`);
      setState(next);
      const current = next.runs[0];
      if (
        current?.applied_at &&
        current.auto_apply &&
        current.id !== loaded.current &&
        !latest.current.dirty &&
        latest.current.record?.updated_at === current.baseline_updated_at
      ) {
        loaded.current = current.id;
        await latest.current.onLoad();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      refreshing.current = false;
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [record?.id, record?.updated_at]);
  useEffect(() => {
    setComplete(false);
    setConfirmed(false);
    setAck([]);
    setDifferenceReview(false);
  }, [state?.revision, run?.id]);
  useEffect(() => {
    setConfirmed(false);
  }, [data]);
  async function action(label: string, fn: () => Promise<unknown>) {
    setWorking(label);
    setBusy(label);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking("");
      setBusy("");
    }
  }
  async function upload(files: File[]) {
    if (!record) return;
    await action("Uploading files…", async () => {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        await evalRequest(`documents/${record.id}`, {
          method: "POST",
          body: form,
        });
      }
      setComplete(false);
    });
  }
  async function generate() {
    if (!record || !state || !complete || dirty) return;
    await action("Confirming materials…", () =>
      evalRequest(`generation/${record.id}`, {
        method: "POST",
        body: JSON.stringify({
          action: "confirm",
          id: crypto.randomUUID(),
          revision: state.revision,
          expectedUpdatedAt: record.updated_at,
          confirmed: true,
        }),
      }),
    );
  }
  async function control(actionName: "cancel" | "retry" | "apply") {
    if (!record || !run) return;
    await action(
      actionName === "apply"
        ? "Applying reviewed draft…"
        : "Updating generation…",
      async () => {
        await evalRequest(`generation/${record.id}`, {
          method: "POST",
          body: JSON.stringify({
            action: actionName,
            id: run.id,
            expectedUpdatedAt: record.updated_at,
            confirmed: actionName === "apply" && differenceReview,
          }),
        });
        if (actionName === "apply") await onLoad();
      },
    );
  }
  async function approve() {
    if (!record || !run) return;
    await action("Recording human approval…", () =>
      evalRequest(`approval/${record.id}`, {
        method: "POST",
        body: JSON.stringify({
          runId: run.id,
          expectedUpdatedAt: record.updated_at,
          reviewer,
          notes,
          acknowledgedIssues: ack,
          confirmed,
        }),
      }),
    );
  }
  async function download() {
    if (!record) return;
    setDownloadError("");
    try {
      const response = await fetch(`/api/admin/eval/approved/${record.id}`);
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = "AET-Approved-Evaluation.docx";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setDownloadError((e as Error).message);
    }
  }
  if (!active) return null;
  if (!record)
    return (
      <div className="eval-workflow">
        <p>Save this report first, then upload its source files here.</p>
      </div>
    );
  const currentApproval =
    !!state?.approvalCurrent &&
    state.approval?.report_updated_at === record.updated_at &&
    !dirty;
  const missing = requiredReviewFields(data),
    sameMaterials = run?.material_revision === state?.revision;
  const changes = run?.result
    ? draftDifferences(data, run.result.draft).filter(
        (key) => key !== "evidence",
      )
    : [];
  return (
    <div className="eval-workflow">
      <p className="eval-panel-hint">
        Upload the complete file set. We prepare a draft; you review and confirm
        the final report.
      </p>
      {error && (
        <div className="eval-alert" role="alert">
          {error}
        </div>
      )}
      {working && <p role="status">{working}</p>}
      <section>
        <h3>1. Source files</h3>
        <p>PDF, PNG, JPEG or WebP · up to 8 files · 20 MB each</p>
        <label
          className={`eval-button eval-upload-label ${disabled || running ? "disabled" : ""}`}
        >
          <Upload size={16} /> Upload source files
          <input
            aria-label="Upload source files"
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg,image/webp"
            disabled={disabled || running}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              void upload(files);
            }}
          />
        </label>
        <ul className="eval-source-list">
          {state?.documents.map((doc) => (
            <li key={doc.id}>
              <div>
                <a
                  href={`/api/admin/eval/source/${doc.id}?reportId=${record.id}`}
                >
                  {doc.name}
                </a>
                <small>
                  {(doc.size / 1024).toFixed(0)} KB
                  {doc.excluded ? " · Excluded" : ""}
                </small>
              </div>
              <button
                className="eval-tool-button"
                disabled={disabled || running}
                onClick={() =>
                  void action("Updating materials…", () =>
                    evalRequest(`documents/${record.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        id: doc.id,
                        excluded: !doc.excluded,
                      }),
                    }),
                  )
                }
              >
                {doc.excluded ? "Include" : "Exclude"}
              </button>
            </li>
          ))}
        </ul>
        {!state?.documents.some((doc) => !doc.excluded) && (
          <p>No source files uploaded yet.</p>
        )}
        <label className="eval-check">
          <input
            type="checkbox"
            checked={complete}
            disabled={disabled || running}
            onChange={(e) => setComplete(e.target.checked)}
          />
          All required files and pages have finished uploading.
        </label>
        {dirty && (
          <p className="eval-panel-hint">
            Save report changes before generating, applying or approving.
          </p>
        )}
        {state && !state.providerReady && (
          <p role="alert">
            The OpenAI API key is not configured on the server.
          </p>
        )}
        <button
          className="eval-button primary"
          disabled={
            disabled ||
            running ||
            dirty ||
            !complete ||
            !state?.providerReady ||
            !state.documents.some((d) => !d.excluded)
          }
          onClick={() => void generate()}
        >
          {run ? "Generate a new draft" : "Confirm files & generate draft"}
        </button>
      </section>
      <section>
        <h3>2. Draft & evidence</h3>
        {!run ? (
          <p>Your draft will appear in the editable report.</p>
        ) : (
          <>
            <p className="eval-run-status" role="status">
              <FileCheck2 size={17} />
              {run.step}
            </p>
            <p className="eval-panel-hint">
              Material set {run.material_revision} · Template{" "}
              {run.template.version}
            </p>
            {running && (
              <>
                <p>
                  You may leave this page. The background worker keeps your
                  progress.
                </p>
                {run.status === "queued" && (
                  <p className="eval-panel-hint">
                    Waiting for the generation worker. If this does not change,
                    check that the local worker is running.
                  </p>
                )}
                <button
                  className="eval-button"
                  disabled={disabled}
                  onClick={() => void control("cancel")}
                >
                  Cancel generation
                </button>
              </>
            )}
            {run.error && (
              <p role="alert" className="eval-alert">
                {run.error}
              </p>
            )}
            {(run.status === "failed" || run.status === "cancelled") && (
              <button
                className="eval-button"
                disabled={disabled || !sameMaterials || run.calls >= 24}
                onClick={() => void control("retry")}
              >
                Retry from saved progress
              </button>
            )}
            {!sameMaterials && (
              <p className="eval-alert">
                Files changed after this run. Confirm the new material set to
                generate again.
              </p>
            )}
            {run.result && (
              <>
                <details>
                  <summary>
                    Review proposed changes ({changes.length} sections)
                  </summary>
                  {changes.length ? (
                    changes.map((key) => (
                      <details className="eval-difference" key={key}>
                        <summary>{reportSectionLabels[key] || key}</summary>
                        {differenceRows(data[key], run.result!.draft[key]).map(
                          (row) => (
                            <div
                              className="eval-field-difference"
                              key={row.label}
                            >
                              <strong>{row.label}</strong>
                              <p>
                                <span>Current</span>
                                {row.before}
                              </p>
                              <p>
                                <span>Proposed</span>
                                {row.after}
                              </p>
                            </div>
                          ),
                        )}
                      </details>
                    ))
                  ) : (
                    <p>The report matches this generated draft.</p>
                  )}
                </details>
                {!run.applied_at ? (
                  <>
                    <label className="eval-check">
                      <input
                        type="checkbox"
                        checked={differenceReview}
                        onChange={(e) => setDifferenceReview(e.target.checked)}
                      />
                      I reviewed these differences and want to replace the saved
                      report with this draft.
                    </label>
                    <button
                      className="eval-button"
                      disabled={
                        disabled || dirty || !sameMaterials || !differenceReview
                      }
                      onClick={() => void control("apply")}
                    >
                      Apply reviewed draft
                    </button>
                  </>
                ) : (
                  <p>
                    The generated draft is saved. Edit it directly in the
                    report.
                  </p>
                )}
                {run.applied_at &&
                  record.updated_at === run.baseline_updated_at &&
                  dirty && (
                    <p className="eval-alert">
                      The generated draft is saved on the server. Your unsaved
                      edits are retained; reload after copying them or resolve
                      the save conflict.
                    </p>
                  )}
                <details>
                  <summary>
                    Source evidence ({run.result.draft.evidence?.length || 0})
                  </summary>
                  <p>
                    AI-extracted quotations need comparison with the original
                    files.
                  </p>
                  {run.result.draft.evidence?.map((item) => (
                    <div className="eval-evidence-item" key={item.id}>
                      <strong>{item.label}</strong>
                      <p>{item.value}</p>
                      {item.refs.map((ref, i) => (
                        <div key={i}>
                          <a
                            href={`/api/admin/eval/source/${ref.docId}?reportId=${record.id}`}
                          >
                            Source · page {ref.page}
                          </a>
                          <blockquote>{ref.quote}</blockquote>
                        </div>
                      ))}
                    </div>
                  ))}
                </details>
              </>
            )}
          </>
        )}
      </section>
      <section>
        <h3>3. Human review</h3>
        {state?.approval && (
          <p className={currentApproval ? "eval-notice" : "eval-panel-hint"}>
            {currentApproval
              ? `Approved by ${state.approval.reviewer}`
              : "The previous approval is out of date. Review and approve the current report again."}
          </p>
        )}
        {run?.result && run.applied_at && sameMaterials ? (
          <>
            <p>
              Check the source documents, equivalencies, conversions and final
              report. Record how you resolved the items below.
            </p>
            {run.result.issues.map((issue) => (
              <label className="eval-check" key={issue.id}>
                <input
                  type="checkbox"
                  checked={ack.includes(issue.id)}
                  disabled={disabled}
                  onChange={(e) =>
                    setAck(
                      e.target.checked
                        ? [...ack, issue.id]
                        : ack.filter((id) => id !== issue.id),
                    )
                  }
                />
                {issue.message}
              </label>
            ))}
            {missing.length > 0 && (
              <div className="eval-alert">
                <strong>Complete before approval</strong>
                <ul>
                  {missing.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            <label>
              Reviewer name
              <input
                value={reviewer}
                maxLength={120}
                onChange={(e) => setReviewer(e.target.value)}
                placeholder="Your name"
              />
            </label>
            <p className="eval-panel-hint">
              Local review record. Identity is not verified; employee login is
              not enabled.
            </p>
            <label>
              Review notes
              <textarea
                value={notes}
                maxLength={5000}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Explain your source checks, conversion decisions and resolved issues."
                rows={4}
              />
            </label>
            <label className="eval-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I have reviewed the complete report and confirm this saved
              version.
            </label>
            <button
              className="eval-button primary"
              disabled={
                disabled ||
                dirty ||
                currentApproval ||
                !confirmed ||
                reviewer.trim().length < 2 ||
                !notes.trim() ||
                missing.length > 0 ||
                run.result.issues.some((issue) => !ack.includes(issue.id))
              }
              onClick={() => void approve()}
            >
              Confirm final report
            </button>
          </>
        ) : (
          <p>
            Human confirmation becomes available after a generated draft is
            applied.
          </p>
        )}
        {currentApproval && (
          <button
            className="eval-button"
            disabled={disabled}
            onClick={() => void download()}
          >
            Download approved Word
          </button>
        )}
        {downloadError && <p role="alert">{downloadError}</p>}
      </section>
    </div>
  );
}
