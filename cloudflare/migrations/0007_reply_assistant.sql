CREATE TABLE reply_assistant_settings (
  firm_id TEXT PRIMARY KEY REFERENCES firms(id),
  enabled INTEGER NOT NULL DEFAULT 0,
  enabled_at TEXT NOT NULL,
  daily_limit INTEGER NOT NULL DEFAULT 100 CHECK(daily_limit BETWEEN 1 AND 300),
  webhook_secret TEXT NOT NULL,
  webhook_id TEXT,
  last_event_at TEXT,
  last_poll_at TEXT,
  context_revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE reply_jobs (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id),
  agent_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  account_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  question TEXT NOT NULL,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  batch_id TEXT REFERENCES reply_jobs(id),
  claim_key_id TEXT,
  claim_hash TEXT,
  lease_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  context_hash TEXT,
  reply_body TEXT,
  outgoing_id TEXT,
  completed_at TEXT,
  UNIQUE(firm_id,account_id,provider_message_id),
  FOREIGN KEY(agent_id,firm_id) REFERENCES agents(id,firm_id)
);
CREATE INDEX reply_jobs_pending ON reply_jobs(firm_id,state,created_at);
CREATE INDEX reply_jobs_batch ON reply_jobs(batch_id);
CREATE INDEX reply_jobs_budget ON reply_jobs(firm_id,completed_at);
CREATE INDEX cases_agent_context ON cases(firm_id,agent_id,id);
-- Invalidate a draft atomically if its authorized data changes before dispatch.
CREATE TRIGGER reply_cases_insert AFTER INSERT ON cases BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1 WHERE firm_id=NEW.firm_id;
END;
CREATE TRIGGER reply_cases_update AFTER UPDATE ON cases BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1 WHERE firm_id IN (OLD.firm_id,NEW.firm_id);
END;
CREATE TRIGGER reply_cases_delete AFTER DELETE ON cases BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1 WHERE firm_id=OLD.firm_id;
END;
CREATE TRIGGER reply_contacts_update AFTER UPDATE ON whatsapp_contacts BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1 WHERE firm_id=NEW.firm_id;
END;
CREATE TRIGGER reply_contacts_delete AFTER DELETE ON whatsapp_contacts BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1 WHERE firm_id=OLD.firm_id;
END;
CREATE TRIGGER reply_agents_update AFTER UPDATE ON agents BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1 WHERE firm_id=NEW.firm_id;
END;
CREATE TRIGGER reply_rules_insert AFTER INSERT ON whatsapp_rules BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1 WHERE firm_id=NEW.firm_id;
END;
CREATE TRIGGER reply_rules_update AFTER UPDATE ON whatsapp_rules BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1 WHERE firm_id=NEW.firm_id;
END;
CREATE TRIGGER reply_rules_delete AFTER DELETE ON whatsapp_rules BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1 WHERE firm_id=OLD.firm_id;
END;
CREATE TRIGGER reply_connection_update AFTER UPDATE ON whatsapp_settings BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1,
    enabled=CASE WHEN OLD.provider<>NEW.provider OR OLD.zernio_account_id IS NOT NEW.zernio_account_id OR NEW.enabled=0 THEN 0 ELSE enabled END
  WHERE firm_id=NEW.firm_id;
  UPDATE reply_jobs SET state='skipped',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE firm_id=NEW.firm_id AND state IN ('pending','processing','batched')
    AND (OLD.provider<>NEW.provider OR OLD.zernio_account_id IS NOT NEW.zernio_account_id OR NEW.enabled=0);
END;
CREATE TABLE reply_delivery_receipts (
  firm_id TEXT NOT NULL REFERENCES firms(id),
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(firm_id,provider_id)
);
