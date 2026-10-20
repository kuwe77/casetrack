import { fail, now } from "./security";
import type { Env } from "./types";

function limit(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    fail(503, "Document storage limits are not configured correctly.");
  }
  return Number(value);
}

export async function storeDocument(
  env: Env,
  document: { id: string; firmId: string; key: string },
  file: File,
  persist: () => Promise<unknown>,
) {
  if (!env.FILES) fail(503, "Document storage is not configured.");
  const firmBytes = limit(env.DOCUMENT_MAX_FIRM_BYTES, 100 * 1024 * 1024);
  const totalBytes = limit(env.DOCUMENT_MAX_TOTAL_BYTES, 1024 * 1024 * 1024);
  const firmFiles = limit(env.DOCUMENT_MAX_FIRM_FILES, 100);
  const totalFiles = limit(env.DOCUMENT_MAX_TOTAL_FILES, 1000);
  // One SQLite write atomically checks AND reserves all budgets. Separate reads
  // would let simultaneous requests or multiple keys oversubscribe the allowance.
  const reserved = await env.DB.prepare(`INSERT INTO document_allocations(id,firm_id,object_key,size,created_at)
    SELECT ?,?,?,?,?
    WHERE (SELECT COALESCE(SUM(size),0) FROM document_allocations) <= ? - ?
      AND (SELECT COUNT(*) FROM document_allocations) < ?
      AND (SELECT COALESCE(SUM(size),0) FROM document_allocations WHERE firm_id=?) <= ? - ?
      AND (SELECT COUNT(*) FROM document_allocations WHERE firm_id=?) < ?
    RETURNING id`)
    .bind(document.id, document.firmId, document.key, file.size, now(),
      totalBytes, file.size, totalFiles, document.firmId, firmBytes, file.size, document.firmId, firmFiles).first();
  if (!reserved) fail(413, "Document storage allowance reached. Contact the deployment administrator.");
  try {
    await env.FILES.put(document.key, await file.arrayBuffer(), { httpMetadata: { contentType: "application/octet-stream" } });
    await persist();
  } catch (error) {
    // A lost batch response may follow a successful commit. Never delete that
    // document; an unavailable metadata read also leaves its allocation intact.
    const committed = await env.DB.prepare("SELECT id FROM documents WHERE id=? AND object_key=?")
      .bind(document.id, document.key).first();
    if (committed) return;
    // Only refund after confirmed deletion, including ambiguous put failures.
    // A failed delete or interrupted request retains its bounded allocation.
    await env.FILES.delete(document.key);
    await env.DB.prepare("DELETE FROM document_allocations WHERE id=?").bind(document.id).run();
    throw error;
  }
}
