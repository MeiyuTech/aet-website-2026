"use client";
import { useState, useEffect } from "react";
import { buildSampleData, type SampleData } from "@/lib/eval/domain/report";
import type { SavedReport } from "@/lib/eval/domain/records";
import { evalRequest } from "@/lib/eval/client/api";
export function useReportDraft(reportId: string) {
  const [record, setRecord] = useState<SavedReport | null>(null);
  const [data, setData] = useState<SampleData | null>(null);
  const [name, setName] = useState("Untitled evaluation");
  const [id, setId] = useState("");
  const [baseline, setBaseline] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = !!data && JSON.stringify({ name, content: data }) !== baseline;
  async function load() {
    setError("");
    try {
      if (reportId === "new") {
        const content = buildSampleData();
        setId(crypto.randomUUID());
        setData(content);
        setBaseline(JSON.stringify({ name: "Untitled evaluation", content }));
      } else {
        const row = await evalRequest<SavedReport>(`reports/${reportId}`);
        setRecord(row);
        setId(row.id);
        setName(row.name || "Untitled evaluation");
        setData(row.content);
        setBaseline(
          JSON.stringify({
            name: row.name || "Untitled evaluation",
            content: row.content,
          }),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [reportId]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  useEffect(() => {
    document.title = `${name} · AET Eval`;
  }, [name]);
  async function save() {
    if (!data) return;
    setBusy("Saving report…");
    setError("");
    setNotice("");
    try {
      const row = await evalRequest<SavedReport>("reports", {
        method: "POST",
        body: JSON.stringify({
          id,
          name,
          content: data,
          expectedUpdatedAt: record?.updated_at || null,
        }),
      });
      setRecord(row);
      setBaseline(JSON.stringify({ name: row.name, content: row.content }));
      setName(row.name);
      setData(row.content);
      setNotice("Report saved. A new history version is available.");
      if (reportId === "new")
        window.history.replaceState(null, "", `/admin/eval/${id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function exportDocx() {
    if (!data) return;
    setBusy("Preparing Word document…");
    setError("");
    try {
      const response = await fetch("/api/admin/eval/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(name || "AET Evaluation").replace(/[\\/:*?"<>|]/g, "-")}.docx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function change(value: SampleData) {
    setData(value);
    setNotice("");
  }
  return {
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
    change,
  };
}
