-- Removes the demo tickets (db/demo-tickets.sql) for good: from the data and
-- from everything OneTouch kept about them. From PowerShell, in this folder:
--
--   Get-Content db\demo-tickets-remove.sql | docker exec -i analytics_postgres psql -U admin -d analytics_db
--   docker restart analytics_node_app

\set ON_ERROR_STOP on

BEGIN;
DELETE FROM sc_task WHERE number ~ '^SCTASK99000[0-9]{2}$';
DELETE FROM sc_req_item WHERE number ~ '^RITM99000[0-9]{2}$';
DELETE FROM change_request WHERE number ~ '^CHG99000[0-9]{2}$';
DELETE FROM incident WHERE number ~ '^INC99000[0-9]{2}$';
COMMIT;

\connect onetouch_auth
BEGIN;
DELETE FROM notifications WHERE EXISTS (SELECT 1 FROM unnest(numbers) n WHERE n ~ '^(INC|CHG|RITM|SCTASK)99000[0-9]{2}$');
DELETE FROM ticket_reports WHERE number ~ '^(INC|CHG|RITM|SCTASK)99000[0-9]{2}$';
DELETE FROM starred_tickets WHERE number ~ '^(INC|CHG|RITM|SCTASK)99000[0-9]{2}$';
DELETE FROM seen_tickets WHERE number ~ '^(INC|CHG|RITM|SCTASK)99000[0-9]{2}$';
DELETE FROM ticket_families WHERE id ~ '^(INC|CHG|RITM|SCTASK)99000[0-9]{2}$'; -- and their assignments
COMMIT;

\echo 'Demo tickets removed. Now run: docker restart analytics_node_app'
