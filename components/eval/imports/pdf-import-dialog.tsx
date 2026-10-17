"use client";
import { useEffect, useRef, useState } from "react";
import { Upload, Plus, X } from "lucide-react";
import type { SampleData } from "@/lib/eval/domain/report";
import { calculateStats } from "@/lib/eval/domain/gpa";
import { evalRequest } from "@/lib/eval/client/api";
type Props = {
  open: boolean;
  data: SampleData | null;
  busy: string;
  error: string;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  onClose: () => void;
  onApply: (value: SampleData) => void;
};
export function PdfImportDialog({
  open,
  data,
  busy,
  error,
  setBusy,
  setError,
  onClose,
  onApply,
}: Props) {
  const [importResult, setImportResult] = useState<{
    data: Partial<SampleData>;
    warnings: string[];
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) {
      setImportResult(null);
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [open]);
  async function parse(file: File) {
    setBusy("Reading PDF and preparing a draft…");
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      setImportResult(await evalRequest("parse", { method: "POST", body }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const applyImport = () => {
    if (!data || !importResult) return;
    const merged = { ...data, ...importResult.data };
    merged.credentials = merged.credentials.map((c) => ({
      ...c,
      ...calculateStats(c.courses),
    }));
    onApply(merged);
    onClose();
    setImportResult(null);
  };
  return (
    <dialog
      className="eval-dialog"
      ref={dialog}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <header>
        <div>
          <p className="eval-eyebrow">DOCUMENT IMPORT</p>
          <h2>From PDF to working draft</h2>
        </div>
        <button
          className="eval-icon-button"
          aria-label="Close PDF import"
          disabled={!!busy}
          onClick={() => onClose()}
        >
          <X size={20} />
        </button>
      </header>
      <p>
        Choose a transcript or credential document. Gemini will extract the
        details and propose conversions for your review.
      </p>
      {error && (
        <p className="eval-alert" role="alert">
          {error}
        </p>
      )}
      {!importResult ? (
        <label className="eval-upload-area">
          <Upload size={28} />
          <strong>{busy || "Choose a PDF document"}</strong>
          <span>PDF · up to 20 MB</span>
          <input
            aria-label="Upload credential PDF"
            type="file"
            accept="application/pdf"
            disabled={!!busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void parse(file);
            }}
          />
        </label>
      ) : (
        <div className="eval-import-review">
          <h3>Review extracted draft</h3>
          <p>
            <strong>{importResult.data.name || "Name not found"}</strong> ·{" "}
            {importResult.data.country || "Country not found"}
          </p>
          {importResult.warnings.map((w, i) => (
            <p className="eval-soft-note" key={i}>
              {w}
            </p>
          ))}
          {importResult.data.credentials?.map((c, i) => (
            <details key={i}>
              <summary>
                {c.program || `Credential ${i + 1}`} · {c.courses.length}{" "}
                courses
              </summary>
              <p>{c.awardingInstitution}</p>
              <p>{c.equivalenceStatement}</p>
              <div className="eval-table-scroll">
                <table className="eval-course-table">
                  <thead>
                    <tr>
                      <th>Course</th>
                      <th>Original grade</th>
                      <th>US grade</th>
                      <th>US credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.courses.map((course) => (
                      <tr key={course.id}>
                        <td>{course.name}</td>
                        <td>{course.grade}</td>
                        <td>{course.usGrade}</td>
                        <td>{course.usCredits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
          <p className="eval-muted">
            Applying replaces the applicant details, credentials, and documents
            in this draft. It does not save the report.
          </p>
          <div className="eval-dialog-actions">
            <button
              className="eval-button"
              onClick={() => setImportResult(null)}
            >
              Choose another PDF
            </button>
            <button
              className="eval-button primary"
              disabled={!!busy}
              onClick={applyImport}
            >
              <Plus size={16} />
              Apply to draft
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
