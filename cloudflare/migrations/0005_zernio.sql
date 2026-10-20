ALTER TABLE whatsapp_settings ADD COLUMN provider TEXT NOT NULL DEFAULT 'meta';
ALTER TABLE whatsapp_settings ADD COLUMN zernio_account_id TEXT;
ALTER TABLE whatsapp_settings ADD COLUMN zernio_api_key TEXT;
ALTER TABLE whatsapp_settings ADD COLUMN account_label TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX whatsapp_zernio_account ON whatsapp_settings(zernio_account_id) WHERE zernio_account_id IS NOT NULL;
ALTER TABLE whatsapp_messages ADD COLUMN conversation_id TEXT;
CREATE INDEX whatsapp_conversation_messages ON whatsapp_messages(firm_id,conversation_id,created_at);
ALTER TABLE whatsapp_contacts ADD COLUMN consent_updated_at TEXT NOT NULL DEFAULT '';
