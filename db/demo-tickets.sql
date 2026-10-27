-- =====================================================================
-- DEMO TICKETS for presentations: 11 made-up tickets in 5 families, on no
-- team and assigned to nobody, ready to move to the Milwaukee Brewers live
-- (Team tab → Move tickets to another team) and hand out to its players.
-- Their numbers are in a range the real export never uses (…99000xx), and
-- every summary starts with "[Demo]", so they're never mistaken for real
-- tickets in lists, dashboards or the AI assistant's answers.
--
--   INC9900001  parent incident + 3 child incidents   (P2, packaging line down)
--   CHG9900001  change + the incident it fixes          (INC9900005)
--   RITM9900001 request + 2 catalog tasks               (order REQ9900001)
--   INC9900006  on its own                              (P4, badge reader)
--   INC9900007  on its own                              (P3, reopened, passed around)
--
-- Running this again starts the demo over: it removes them, and everything
-- OneTouch kept about them (team, assignments, notifications, reports, stars,
-- ticket results), then adds them again. db/demo-tickets-remove.sql removes
-- them for good. From PowerShell, in this folder:
--
--   Get-Content db\demo-tickets.sql | docker exec -i analytics_postgres psql -U admin -d analytics_db
--   docker restart analytics_node_app
--
-- The restart makes OneTouch read them (its KPIs and sorting read every
-- ticket when it starts). Dates stay inside the export (up to Sep 1, 2026),
-- because "now" for the KPIs is the newest moment in the data.
-- Remove them before seeding the teams again, or they'd join a real team.
-- =====================================================================

\set ON_ERROR_STOP on

-- ---- The tickets themselves (analytics_db, read by Cube and Metabase) ----
BEGIN;
-- Any from an earlier run (the same as demo-tickets-remove.sql)
DELETE FROM sc_task WHERE number ~ '^SCTASK99000[0-9]{2}$';
DELETE FROM sc_req_item WHERE number ~ '^RITM99000[0-9]{2}$';
DELETE FROM change_request WHERE number ~ '^CHG99000[0-9]{2}$';
DELETE FROM incident WHERE number ~ '^INC99000[0-9]{2}$';

INSERT INTO incident (number, created, updated, short_description, description, affected_user, assignment_group, assigned_to,
  state, parent_incident, priority, impact, urgency, category, subcategory, was_p1, global_incident, configuration_item,
  contact_type, reassignment_count, reopen_count, opened_by_group, location, on_hold_reason, work_notes) VALUES
('INC9900001', '2026-08-31 07:12:00', '2026-09-01 18:40:00', '[Demo] Packaging line 4 labeler offline at the Milwaukee brewery',
 'Line 4 has stopped labeling cases since 6:50 AM. Operators restarted the labeler twice; it faults again within minutes. Cases are being held at the end of the line.',
 'Individual 9901', 'MC-GLP-MES-PACK', 'Individual 9911', 'In Progress', NULL, 'P2 - High', '2 - Site/Dept', '1 - xxx (Immediate Loss)',
 'Hardware', 'Printer', 'false', 'false', 'MKE-PKG-L4-LABELER', 'Phone', '1', '0', 'TCS-ServiceDesk-L1-NA-WE', 'Milwaukee Brewery', NULL,
 '2026-09-01 18:40:00 - Individual 9911 (Work notes)' || chr(10) || 'Vendor engineer on site; replacing the print head controller.'),
('INC9900002', '2026-08-31 06:58:00', '2026-08-31 07:15:00', '[Demo] Labeler on line 4 shows fault code E-217',
 'Monitoring alert: labeler MKE-PKG-L4-LABELER reported fault E-217 (print head communication error).',
 'Event Ops', 'MC-GLP-MES-PACK', NULL, 'New', 'INC9900001', 'P3 - Average', '3 - Multiple Users', '3 - xxx (No Loss)',
 'Hardware', 'Printer', 'false', 'false', 'MKE-PKG-L4-LABELER', 'Event Management', '0', '0', 'ACN-MEM-ALERTING', 'Milwaukee Brewery', NULL, NULL),
('INC9900003', '2026-08-31 07:05:00', '2026-08-31 07:16:00', '[Demo] Line 4 operators cannot print case labels',
 'Case labels come out blank on line 4. Tried reloading the label roll.',
 'Individual 9902', 'MC-GLP-MES-PACK', NULL, 'New', 'INC9900001', 'P3 - Average', '3 - Multiple Users', '2 - xxx (Workaround)',
 'Hardware', 'Printer', 'false', 'false', 'MKE-PKG-L4-LABELER', 'Self-service', '0', '0', 'TCS-ServiceDesk-L1-NA-WE', 'Milwaukee Brewery', NULL, NULL),
('INC9900004', '2026-08-31 07:20:00', '2026-08-31 07:22:00', '[Demo] Line 4 output stopped; shift lead reporting',
 'Shift lead called: line 4 output has stopped while labels are down.',
 'Individual 9903', 'MC-GLP-MES-PACK', NULL, 'New', 'INC9900001', 'P3 - Average', '2 - Site/Dept', '1 - xxx (Immediate Loss)',
 'Hardware', 'Printer', 'false', 'false', 'MKE-PKG-L4-LABELER', 'Phone', '0', '0', 'TCS-ServiceDesk-L1-NA-WE', 'Milwaukee Brewery', NULL, NULL),
('INC9900005', '2026-08-27 09:30:00', '2026-08-31 16:00:00', '[Demo] MES dashboards slow for brewhouse operators',
 'Brewhouse MES screens take 30 seconds or more to load during shift change. The application server runs out of memory at peak.',
 'Individual 9904', 'ACN-L2-MSL3MES', 'Individual 9912', 'On Hold', NULL, 'P3 - Average', '3 - Multiple Users', '2 - xxx (Workaround)',
 'Software/Configuration', 'Performance', 'false', 'false', 'MKE-MES-APP01', 'Email', '2', '0', 'TCS-ServiceDesk-L1-NA-WE', 'Milwaukee Brewery', 'Awaiting Change',
 '2026-08-31 16:00:00 - Individual 9912 (Work notes)' || chr(10) || 'Change CHG9900001 raised to add memory to the application server.'),
('INC9900006', '2026-09-01 08:05:00', '2026-09-01 08:05:00', '[Demo] Badge reader at Milwaukee brewery gate 2 not reading cards',
 'Gate 2 badge reader shows a red light for every badge. Security is letting people in by hand.',
 'Individual 9905', 'TCS-EUS-Remote-Support', NULL, 'New', NULL, 'P4 - Low', '4 - User', '4 - Low',
 'Hardware', 'Badge Reader', 'false', 'false', 'MKE-SEC-GATE2-READER', 'Walk-in', '0', '0', 'TCS-ServiceDesk-L1-NA-WE', 'Milwaukee Brewery', NULL, NULL),
('INC9900007', '2026-08-24 13:40:00', '2026-08-28 10:00:00', '[Demo] Wi-Fi keeps dropping in the Milwaukee brewery warehouse',
 'Handheld scanners lose Wi-Fi in aisles 12 to 18 several times an hour. Reopened: the access point restart only helped for a day.',
 'Individual 9906', 'TCS-Network-Data', 'Individual 9913', 'In Progress', NULL, 'P3 - Average', '3 - Multiple Users', '2 - xxx (Workaround)',
 'Network', 'Wireless', 'false', 'false', 'MKE-WHSE-AP-12', 'Chat', '3', '1', 'TCS-ServiceDesk-L1-NA-WE', 'Milwaukee Brewery', NULL,
 '2026-08-28 10:00:00 - Individual 9913 (Work notes)' || chr(10) || 'Waiting for a site survey of the warehouse access points.');

INSERT INTO change_request (number, type, created, sub_type, task_type, configuration_item, short_description, owner_group, outage,
  state, state_1, approval, requested_by, planned_start_date, planned_end_date, planned_start_date_1, planned_end_date_1, risk,
  incident, environment, brewery, brewery_locations, description, purpose_of_change) VALUES
('CHG9900001', 'Normal', '2026-08-31 11:00:00', 'Infrastructure', 'Change Request', 'MKE-MES-APP01',
 '[Demo] Add memory to the Milwaukee MES application server', 'ACN-L2-MSL3MES', 'Yes',
 'Pending', 'Pending', 'Requested', 'Individual 9912',
 '2026-09-03 22:00:00', '2026-09-04 02:00:00', '2026-09-03 22:00:00', '2026-09-04 02:00:00', 'Medium',
 'INC9900005', 'Production', 'Yes', 'Milwaukee',
 'Add 32 GB of memory to MKE-MES-APP01 during the overnight window. MES screens are down for about an hour.',
 'Fix the slow brewhouse MES dashboards (INC9900005).');

INSERT INTO sc_req_item (number, item, short_description, description, opened, updated, stage, state, request, requested_for, opened_by, approval, location) VALUES
('RITM9900001', 'Laptop - Standard', '[Demo] New laptop for the Milwaukee brewery shift supervisor',
 'New shift supervisor starts September 8 and needs a standard laptop with the brewery production apps.',
 '2026-08-30 10:15:00', '2026-08-31 09:00:00', 'Fulfillment', 'Open', 'REQ9900001', 'Individual 9907', 'Individual 9907', 'Approved', 'Milwaukee Brewery');

INSERT INTO sc_task (number, item, state, short_description, assignment_group, parent, opened_by, approval, request, request_item, sla_flag, created, updated, active) VALUES
('SCTASK9900001', 'Laptop - Standard', 'Work in Progress', '[Demo] Image and configure the laptop', 'TCS-USHWASSETMGMT',
 'RITM9900001', 'Individual 9907', 'Not Yet Requested', 'REQ9900001', 'RITM9900001', 'false', '2026-08-30 10:16:00', '2026-08-31 09:00:00', 'true'),
('SCTASK9900002', 'Laptop - Standard', 'Open', '[Demo] Deliver the laptop to the Milwaukee brewery', 'TCS-EUS-Remote-Support',
 'RITM9900001', 'Individual 9907', 'Not Yet Requested', 'REQ9900001', 'RITM9900001', 'true', '2026-08-30 10:16:00', '2026-08-30 10:16:00', 'true');
COMMIT;

-- ---- In OneTouch (onetouch_auth): their families, on no team, assigned to nobody ----
\connect onetouch_auth
BEGIN;
-- Anything OneTouch kept about them from an earlier run
DELETE FROM notifications WHERE EXISTS (SELECT 1 FROM unnest(numbers) n WHERE n ~ '^(INC|CHG|RITM|SCTASK)99000[0-9]{2}$');
DELETE FROM ticket_reports WHERE number ~ '^(INC|CHG|RITM|SCTASK)99000[0-9]{2}$';
DELETE FROM starred_tickets WHERE number ~ '^(INC|CHG|RITM|SCTASK)99000[0-9]{2}$';
DELETE FROM seen_tickets WHERE number ~ '^(INC|CHG|RITM|SCTASK)99000[0-9]{2}$';
DELETE FROM ticket_families WHERE id ~ '^(INC|CHG|RITM|SCTASK)99000[0-9]{2}$'; -- and their assignments

-- A family's id is its lowest ticket number (teams.mjs linkedGroups)
INSERT INTO ticket_families (id, team_id, size) VALUES
  ('INC9900001', NULL, 4), ('CHG9900001', NULL, 2), ('RITM9900001', NULL, 3), ('INC9900006', NULL, 1), ('INC9900007', NULL, 1);
INSERT INTO ticket_assignments (number, family_id) VALUES
  ('INC9900001', 'INC9900001'), ('INC9900002', 'INC9900001'), ('INC9900003', 'INC9900001'), ('INC9900004', 'INC9900001'),
  ('CHG9900001', 'CHG9900001'), ('INC9900005', 'CHG9900001'),
  ('RITM9900001', 'RITM9900001'), ('SCTASK9900001', 'RITM9900001'), ('SCTASK9900002', 'RITM9900001'),
  ('INC9900006', 'INC9900006'),
  ('INC9900007', 'INC9900007');
COMMIT;

\echo 'Demo tickets ready: 11 tickets in 5 families, on no team, assigned to nobody. Now run: docker restart analytics_node_app'
