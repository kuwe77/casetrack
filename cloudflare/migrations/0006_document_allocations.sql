-- Count pending uploads as well as completed documents. No automatic expiry:
-- an interrupted request may have written its R2 object before losing its response.
CREATE TABLE document_allocations (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id),
  object_key TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL CHECK(size > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX document_allocations_firm ON document_allocations(firm_id, size);
-- Older API instances may still finish uploads during a rolling deployment.
-- Keep those committed documents counted; new instances reserve this row first.
CREATE TRIGGER documents_allocate_after_insert AFTER INSERT ON documents
BEGIN
  INSERT INTO document_allocations(id,firm_id,object_key,size,created_at)
    VALUES(NEW.id,NEW.firm_id,NEW.object_key,NEW.size,NEW.created_at)
    ON CONFLICT(id) DO NOTHING;
END;
INSERT INTO document_allocations(id,firm_id,object_key,size,created_at)
  SELECT id,firm_id,object_key,size,created_at FROM documents;
