CREATE TABLE whatsapp_rules (
  firm_id TEXT NOT NULL REFERENCES firms(id), case_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0, interval_hours INTEGER NOT NULL DEFAULT 72 CHECK(interval_hours BETWEEN 24 AND 2160),
  next_due_at TEXT NOT NULL, shared_update TEXT NOT NULL DEFAULT '',
  template_name TEXT NOT NULL, template_language TEXT NOT NULL DEFAULT 'en_US',
  PRIMARY KEY(firm_id,case_id), FOREIGN KEY(case_id,firm_id) REFERENCES cases(id,firm_id)
);
CREATE INDEX rules_due ON whatsapp_rules(enabled,next_due_at);
