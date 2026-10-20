CREATE INDEX cases_page ON cases(firm_id,id);
CREATE INDEX agents_page ON agents(firm_id,id);
CREATE INDEX tasks_page ON tasks(firm_id,id);
CREATE INDEX activities_page ON activities(firm_id,id);
CREATE INDEX documents_page ON documents(firm_id,id);
CREATE INDEX messages_page ON whatsapp_messages(firm_id,id);
CREATE INDEX api_usage_expiry ON api_usage(expires_at);
