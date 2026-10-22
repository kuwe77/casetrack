import { useEffect, useState } from "react";
import { FileText, UploadSimple, ArrowDown } from "@phosphor-icons/react";
import { api, workspaceDownloadUrl } from "../lib/api";
import { errorMessage } from "../lib/repository";
import { Button } from "./ui/button";
import { dateLabel } from "../lib/model";
interface Document { id: string; case_id: string; filename: string; size: number; created_at: string }
export function CaseDocuments({ caseId }: { caseId: string }) {
  const [docs, setDocs] = useState<Document[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [available, setAvailable] = useState<boolean | null>(null);
  const [filename, setFilename] = useState(""), [loading, setLoading] = useState(true);
  async function refresh() {
    const status = await fetch("/api/health").then(r=>r.json()) as { files: boolean };
    setAvailable(status.files);
    let cursor: string | null = "", all: Document[] = [];
    do {
      const result: { data: Document[]; nextCursor: string | null } = await api(`/documents${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      all = [...all, ...result.data]; cursor = result.nextCursor;
    } while (cursor);
    setDocs(all.filter(d => d.case_id === caseId));
  }
  useEffect(() => { setLoading(true); void refresh().catch(e => setError(errorMessage(e))).finally(() => setLoading(false)); }, [caseId]);
  return <section className="case-documents"><h3>Case documents</h3><p className="case-help">Files are private to your firm. Maximum 10 MB per file.</p>
    {available === false && <p role="status" className="case-help">Document uploads are not available yet. Contact your administrator.</p>}
    <form className="case-upload" onSubmit={async e => {
    e.preventDefault(); const form = e.currentTarget; setBusy(true); setError("");
    try { await api(`/cases/${caseId}/documents`, { method: "POST", body: new FormData(form) }); form.reset(); setFilename(""); await refresh(); }
    catch(e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }}><label className="case-file-picker"><UploadSimple size={22}/><span><strong>{filename || "Choose a document"}</strong><small>{filename ? "Choose another file" : "Select a file from your device"}</small></span><input type="file" name="file" aria-label="Choose a document" required disabled={busy || !available} onChange={e => setFilename(e.target.files?.[0]?.name || "")}/></label>
    {filename && <Button disabled={busy || !available}>{busy ? "Uploading…" : "Upload document"}</Button>}</form>
    {error && <p role="alert" className="form-error">{error}</p>}
    {loading ? <p role="status" className="case-help">Loading documents…</p> : docs.length ? <ul className="case-document-list">{docs.map(d => <li key={d.id}><FileText size={21}/><div><a href={workspaceDownloadUrl(d.id)}>{d.filename}</a><small>{Math.ceil(d.size / 1024)} KB · {dateLabel(d.created_at)}</small></div><ArrowDown size={17} aria-hidden="true"/></li>)}</ul> : !error && <div className="case-documents-empty"><FileText size={28}/><strong>No documents yet</strong><p>Add agreements, forms and supporting files for this case.</p></div>}
  </section>;
}
