-- Keep existing firm IDs and every dependent record. D1 applies this migration
-- atomically; defer foreign keys while replacing the two single-workspace tables.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE firms_copy AS SELECT * FROM firms;
DROP TABLE firms;
CREATE TABLE firms (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', owner_id TEXT NOT NULL REFERENCES "user"(id), created_at TEXT NOT NULL);
INSERT INTO firms SELECT * FROM firms_copy;
DROP TABLE firms_copy;
CREATE INDEX firms_owner ON firms(owner_id);

CREATE TABLE workspace_members_copy AS SELECT * FROM workspace_members;
DROP TABLE workspace_members;
CREATE TABLE workspace_members (user_id TEXT NOT NULL REFERENCES "user"(id), firm_id TEXT NOT NULL REFERENCES firms(id), email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')), created_at TEXT NOT NULL, PRIMARY KEY(user_id,firm_id));
INSERT INTO workspace_members SELECT * FROM workspace_members_copy;
DROP TABLE workspace_members_copy;
CREATE INDEX members_firm ON workspace_members(firm_id);
PRAGMA defer_foreign_keys = OFF;
