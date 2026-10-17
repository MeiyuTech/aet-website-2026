"use client";
import Link from "next/link";
import { ArrowUpRight, FileText, BookOpen, ArrowLeft } from "lucide-react";
export function Brand({ onNavigate }: { onNavigate?: () => void } = {}) {
  return (
    <Link
      className="eval-brand"
      href="/admin/eval"
      onClick={
        onNavigate
          ? (e) => {
              e.preventDefault();
              onNavigate();
            }
          : undefined
      }
    >
      <img src="/brand/aet-icon-48.png" width="40" height="40" alt="AET" />
      <span>
        AET <strong>Eval</strong>
        <small>Credential evaluation</small>
      </span>
    </Link>
  );
}
export function SideNav({
  active,
  onChange,
}: {
  active: "reports" | "rules";
  onChange: (v: "reports" | "rules") => void;
}) {
  return (
    <aside className="eval-sidebar">
      <Brand />
      <div className="eval-nav-label">WORKSPACE</div>
      <nav aria-label="Evaluation workspace">
        <button
          className={active === "reports" ? "active" : ""}
          onClick={() => onChange("reports")}
        >
          <FileText size={19} />
          Reports
        </button>
        <button
          className={active === "rules" ? "active" : ""}
          onClick={() => onChange("rules")}
        >
          <BookOpen size={19} />
          Grade reference
        </button>
      </nav>
      <div className="eval-sidebar-bottom">
        <span className="eval-status-dot" />
        Local workspace
        <Link href="/" target="_blank">
          AET website
          <ArrowUpRight size={16} />
        </Link>
      </div>
    </aside>
  );
}
export function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button className="eval-text-button" onClick={onClick}>
      <ArrowLeft size={16} />
      All reports
    </button>
  );
}
