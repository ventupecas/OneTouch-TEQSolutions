-- New tickets from ServiceNow go into the tables the export was loaded into
-- (load_csv.sql: incident, change_request, sc_req_item, sc_task,
-- change_approvals, ritm_approvals), and into a family in onetouch_auth.
-- This file adds the one table the listener needs of its own, in the same
-- database as the ticket tables (analytics_db). The listener also makes it
-- when it starts, if it may.
--
-- Records that can't be saved yet wait here: a catalog task that arrives
-- before its request, an approval before its ticket (the tables link them),
-- or a ticket that couldn't be put in a family. They're tried again after
-- every record saved, and every minute.
--
-- Run once: psql -f db/schema.sql   (or: npm run db:schema, with the PG* variables set)

CREATE TABLE IF NOT EXISTS servicenow_pending (
    id             bigserial PRIMARY KEY,
    table_name     text NOT NULL,
    record_key     text NOT NULL,               -- its number (or approval_id)
    record         jsonb NOT NULL,              -- the newest version received
    reason         text NOT NULL,
    tries          integer NOT NULL DEFAULT 1,
    received_at    timestamptz NOT NULL DEFAULT now(),
    last_tried_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (table_name, record_key)
);

-- The account the listener uses (PGUSER in its .env). Nothing in this repo
-- makes it, so make it first. Run these on analytics_db once this table exists,
-- with the account's name in place of servicenow_sync if it's different:
--
--   GRANT SELECT, INSERT, UPDATE ON incident, change_request, sc_req_item, sc_task,
--     change_approvals, ritm_approvals TO servicenow_sync;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON servicenow_pending TO servicenow_sync;
--   GRANT USAGE ON SEQUENCE servicenow_pending_id_seq TO servicenow_sync;
--
-- DELETE is how a record stops waiting, and it runs after every record saved.
-- USAGE is what lets a record start waiting (the table numbers its rows).
-- In onetouch_auth it uses OneTouch's own account, onetouch_app (AUTH_DB_USER).
