"use client";
import { useEffect, useState } from "react";
import { History, Eye } from "lucide-react";
import type { SampleData } from "@/lib/eval/domain/report";
import type { SavedReport, Revision } from "@/lib/eval/domain/records";
import { evalRequest } from "@/lib/eval/client/api";
import { Field } from "./fields-panel";
type Props = {
  active: boolean;
  record: SavedReport | null;
  id: string;
  busy: string;
  dirty: boolean;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  setRecord: (value: SavedReport) => void;
  onRestore: (value: SampleData) => void;
};
export function HistoryPanel({
  active,
  record,
  id,
  busy,
  dirty,
  setBusy,
  setError,
  setNotice,
  setRecord,
  onRestore,
}: Props) {
  const [versions, setVersions] = useState<Revision[]>([]);
  const [version, setVersion] = useState<Revision | null>(null);
  const [hasMoreVersions, setHasMoreVersions] = useState(false);
  async function loadVersions(offset = 0) {
    if (!record) return;
    try {
      const rows = await evalRequest<Revision[]>(
        `history/${id}?offset=${offset}`,
      );
      setVersions(offset ? [...versions, ...rows] : rows);
      setHasMoreVersions(rows.length === 50);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (active) void loadVersions();
  }, [active, id, record?.updated_at]);
  return (
    <div hidden={!active}>
      <section className="eval-form-section">
        <div className="eval-section-heading">
          <h2>Version history</h2>
          <p>
            Restore a version into the draft, then save to create a new version.
          </p>
        </div>
        {!record ? (
          <p>Save this draft to start its version history.</p>
        ) : (
          <>
            <div className="eval-history-list">
              {versions.map((v) => (
                <button
                  key={v.id}
                  onClick={async () => {
                    try {
                      setVersion(
                        await evalRequest<Revision>(`revision/${v.id}`),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <History size={18} />
                  <span>
                    <strong>{new Date(v.created_at).toLocaleString()}</strong>
                    <small>{v.created_by || "Previous editor"}</small>
                  </span>
                  <Eye size={16} />
                </button>
              ))}
            </div>
            {hasMoreVersions && (
              <button
                className="eval-button"
                onClick={() => loadVersions(versions.length)}
              >
                Load older versions
              </button>
            )}
            {version?.content && (
              <div className="eval-nested-card">
                <h3>Selected version</h3>
                <p>
                  {version.content.name || "Unnamed applicant"} ·{" "}
                  {version.content.credentials.length} credentials ·{" "}
                  {version.content.credentials.reduce(
                    (n, c) => n + c.courses.length,
                    0,
                  )}{" "}
                  courses
                </p>
                <Field
                  label="Evaluation notes in this version"
                  value={version.content.evaluationNotes}
                  onChange={() => {}}
                  multiline
                  readOnly
                />
                <button
                  className="eval-button"
                  disabled={!!busy}
                  onClick={() => {
                    if (
                      !dirty ||
                      confirm("Replace unsaved changes with this version?")
                    ) {
                      onRestore(version.content!);
                      setNotice(
                        "Version restored into the draft. Save to keep it.",
                      );
                    }
                  }}
                >
                  Restore to draft
                </button>
              </div>
            )}
            <div className="eval-danger-zone">
              <h3>
                {record.archived_at
                  ? "Restore archived report"
                  : "Archive report"}
              </h3>
              <p>
                Keep this report, all versions, and its chat history. Archived
                reports can be restored from the workspace.
              </p>
              <button
                className="eval-button"
                disabled={!!busy}
                onClick={async () => {
                  if (
                    dirty &&
                    !confirm(
                      "Archive status will change for the saved report. Unsaved draft edits will remain here. Continue?",
                    )
                  )
                    return;
                  setBusy("Updating archive status…");
                  try {
                    const updated = await evalRequest<SavedReport>(
                      `reports/${id}`,
                      {
                        method: "PATCH",
                        body: JSON.stringify({
                          expectedUpdatedAt: record.updated_at,
                          archived: !record.archived_at,
                        }),
                      },
                    );
                    setRecord(updated);
                    setNotice(
                      updated.archived_at
                        ? "Report archived. You can restore it here."
                        : "Report restored to the active workspace.",
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                {record.archived_at ? "Restore report" : "Archive report"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
