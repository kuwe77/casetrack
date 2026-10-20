import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/repository";
import { Button } from "./ui/button";
interface Document { id: string; case_id: string; filename: string; size: number; created_at: string }
export function CaseDocuments({ caseId }: { caseId: string }) {
  const [docs, setDocs] = useState<Document[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [available, setAvailable] = useState<boolean | null>(null);
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
  useEffect(() => { void refresh().catch(e => setError(errorMessage(e))); }, [caseId]);
  return <section className="mt-6"><h3>Documents</h3><p className="vault-help">Private to your firm. Maximum 10 MB per file. Workspace and service storage allowances also apply.</p>
    {available === false && <p role="status" className="vault-help">Document uploads are not available yet. Contact your administrator.</p>}
    <form className="vault-form" onSubmit={async e => {
    e.preventDefault(); const form = e.currentTarget; setBusy(true); setError("");
    try { await api(`/cases/${caseId}/documents`, { method: "POST", body: new FormData(form) }); form.reset(); await refresh(); }
    catch(e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }}><label>Upload document<input type="file" name="file" required disabled={!available}/></label><Button variant="outline" disabled={busy || !available}>{busy ? "Uploading…" : "Upload document"}</Button></form>
    {error && <p role="alert" className="form-error">{error}</p>}
    {docs.map(d => <div className="team-row" key={d.id}><a className="text-link" href={`/api/v1/documents/${d.id}/download`}>{d.filename}</a><span>{Math.ceil(d.size / 1024)} KB</span></div>)}
  </section>;
}
