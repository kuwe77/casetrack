ALTER TABLE reply_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'reply';
ALTER TABLE reply_jobs ADD COLUMN case_id TEXT;
ALTER TABLE reply_jobs ADD COLUMN stage TEXT;
ALTER TABLE reply_jobs ADD COLUMN expires_at TEXT;
ALTER TABLE reply_jobs ADD COLUMN review_reason TEXT;
CREATE UNIQUE INDEX reply_stage_once ON reply_jobs(firm_id,case_id,stage) WHERE kind='followup';

CREATE TABLE muse_followup_settings (
  firm_id TEXT PRIMARY KEY REFERENCES firms(id),
  enabled INTEGER NOT NULL DEFAULT 0,
  template_name TEXT NOT NULL DEFAULT '',
  template_language TEXT NOT NULL DEFAULT 'en',
  updated_at TEXT NOT NULL
);
CREATE TABLE muse_stage_rules (
  firm_id TEXT NOT NULL REFERENCES firms(id),
  case_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('documents','spa','loan','redemption','stamping','disbursement','completed','on_hold')),
  enabled INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(firm_id,case_id,stage),
  FOREIGN KEY(case_id,firm_id) REFERENCES cases(id,firm_id)
);
CREATE TRIGGER muse_stage_rule_insert AFTER INSERT ON muse_stage_rules BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1 WHERE firm_id=NEW.firm_id;
END;
CREATE TRIGGER muse_stage_rule_update AFTER UPDATE ON muse_stage_rules BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1 WHERE firm_id=NEW.firm_id;
  UPDATE reply_jobs SET state='skipped',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),review_reason='Stage notification disabled'
    WHERE firm_id=NEW.firm_id AND case_id=NEW.case_id AND stage=NEW.stage AND kind='followup'
      AND state IN ('pending','processing') AND NEW.enabled=0;
END;
CREATE TRIGGER muse_stage_rule_delete AFTER DELETE ON muse_stage_rules BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1 WHERE firm_id=OLD.firm_id;
  UPDATE reply_jobs SET state='skipped',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),review_reason='Stage notification removed'
    WHERE firm_id=OLD.firm_id AND case_id=OLD.case_id AND stage=OLD.stage AND kind='followup' AND state IN ('pending','processing');
END;
CREATE TRIGGER muse_followup_settings_update AFTER UPDATE ON muse_followup_settings BEGIN
  UPDATE reply_assistant_settings SET context_revision=context_revision+1 WHERE firm_id=NEW.firm_id;
  UPDATE reply_jobs SET state='skipped',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),review_reason='Stage notifications paused'
    WHERE firm_id=NEW.firm_id AND kind='followup' AND state IN ('pending','processing') AND NEW.enabled=0;
END;
-- Status edits and their notifications commit together. Repeated saves and
-- revisiting a stage do not create another notification for the same case stage.
CREATE TRIGGER muse_case_stage AFTER UPDATE OF status,agent_id ON cases BEGIN
  UPDATE reply_jobs SET state='skipped',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),review_reason='Case stage or agent changed'
    WHERE firm_id=NEW.firm_id AND case_id=NEW.id AND kind='followup' AND state IN ('pending','processing')
      AND (stage<>NEW.status OR agent_id IS NOT NEW.agent_id);
  INSERT INTO reply_jobs(id,firm_id,agent_id,phone,account_id,conversation_id,provider_message_id,question,
    received_at,created_at,kind,case_id,stage,expires_at)
    SELECT lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))),NEW.firm_id,NEW.agent_id,w.phone,s.zernio_account_id,'',
      'stage:'||NEW.id||':'||NEW.status,'Case stage notification',
      strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'followup',NEW.id,NEW.status,
      strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day')
    FROM muse_stage_rules r JOIN muse_followup_settings f ON f.firm_id=r.firm_id
      JOIN reply_assistant_settings a ON a.firm_id=r.firm_id
      JOIN whatsapp_contacts w ON w.firm_id=r.firm_id AND w.agent_id=NEW.agent_id
      JOIN whatsapp_settings s ON s.firm_id=r.firm_id
    WHERE r.firm_id=NEW.firm_id AND r.case_id=NEW.id AND r.stage=NEW.status AND r.enabled=1
      AND OLD.status<>NEW.status AND f.enabled=1 AND a.enabled=1 AND w.enabled=1 AND w.consent=1
      AND s.enabled=1 AND s.provider='zernio' AND s.zernio_account_id IS NOT NULL AND s.zernio_api_key IS NOT NULL
    ON CONFLICT DO NOTHING;
END;
