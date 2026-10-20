BEGIN;

CREATE TABLE IF NOT EXISTS change_request (
    number text PRIMARY KEY,
    type text,
    created text,
    sub_type text,
    task_type text,
    configuration_item text,
    short_description text,
    owner_group text,
    outage text,
    state text,
    approval text,
    close_code text,
    failure_code text,
    success_code text,
    process_failure text,
    diwakar_kumar text,
    requested_by text,
    state_1 text,
    planned_start_date text,
    brewery text,
    brewery_locations text,
    work_notes text,
    planned_end_date text,
    risk text,
    planned_start_date_1 text,
    planned_end_date_1 text,
    description text,
    change_plan text,
    verification_plan text,
    backout_plan text,
    purpose_of_change text,
    incident text,
    problem text,
    enhancement text,
    sap_impact text,
    sap_transport_required text,
    environment text,
    project text,
    comments_and_work_notes text
);

CREATE TABLE IF NOT EXISTS sc_req_item (
    number text PRIMARY KEY,
    item text,
    description text,
    short_description text,
    opened text,
    updated text,
    closed text,
    stage text,
    state text,
    parent text,
    request text,
    requested_for text,
    opened_by text,
    approval text,
    approval_history text,
    approval_set text,
    location text,
    work_notes text,
    fulfilled_time text,
    order_guide text
);

CREATE TABLE IF NOT EXISTS incident (
    number text PRIMARY KEY,
    created text,
    short_description text,
    description text,
    affected_user text,
    assignment_group text,
    assigned_to text,
    problem text,
    state text,
    parent_incident text,
    priority text,
    impact text,
    urgency text,
    breach_reason text,
    global_incident text,
    knowledge_article_reference text,
    category text,
    subcategory text,
    updated text,
    was_p1 text,
    configuration_item text,
    contact_type text,
    reassignment_count text,
    close_code text,
    close_notes text,
    cause_code text,
    cause_sub_code text,
    opened_by_group text,
    location text,
    reopen_count text,
    caused_by_change text,
    business_impact_outage text,
    resolved text,
    closed text,
    responsibility_for_outage text,
    on_hold_reason text,
    work_notes text,
    risk_register_number text,
    tags text,
    third_party_related_ticket text,
    business_impact text,
    downgrade_reason text,
    downgrade_type text,
    kb_article text
);

CREATE TABLE IF NOT EXISTS sc_task (
    number text PRIMARY KEY,
    item text,
    state text,
    short_description text,
    assignment_group text,
    assigned_to text,
    parent text,
    opened_by text,
    approval text,
    approval_history text,
    approval_set text,
    request text,
    request_item text,
    sla_flag text,
    created text,
    updated text,
    additional_comments text,
    description text,
    work_notes text,
    active text
);

CREATE TABLE IF NOT EXISTS change_approvals (
    approval_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_type text,
    parent text NOT NULL REFERENCES change_request(number),
    assignment_group text,
    short_description text,
    created text,
    work_notes text,
    approval text,
    state text
);

CREATE TABLE IF NOT EXISTS ritm_approvals (
    approval_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_type text,
    parent text NOT NULL REFERENCES sc_req_item(number),
    assignment_group text,
    short_description text,
    created text,
    approval text,
    state text
);

CREATE INDEX IF NOT EXISTS sc_task_request_item_idx ON sc_task(request_item);
CREATE INDEX IF NOT EXISTS sc_task_parent_idx ON sc_task(parent);
CREATE INDEX IF NOT EXISTS sc_req_item_request_idx ON sc_req_item(request);

-- Load each CSV that is present in csv_data/. A missing file is skipped with a
-- notice instead of failing the whole setup, so a fresh clone without the
-- export still starts (empty tables; sign-in works, queries return nothing).
DO $$
DECLARE
    loads text[][] := ARRAY[
        ['change_request',   '',                                                                                       'change_request.csv'],
        ['sc_req_item',      '',                                                                                       'sc_req_item.csv'],
        ['incident',         '',                                                                                       'incident.csv'],
        ['sc_task',          '',                                                                                       'sc_task.csv'],
        ['change_approvals', '(task_type, parent, assignment_group, short_description, created, work_notes, approval, state)', 'change_approvals.csv'],
        ['ritm_approvals',   '(task_type, parent, assignment_group, short_description, created, approval, state)',             'ritm_approvals.csv']
    ];
    path text;
BEGIN
    FOR i IN 1 .. array_length(loads, 1) LOOP
        path := '/tmp/my_csv_files/' || loads[i][3];
        IF pg_stat_file(path, true) IS NULL THEN
            RAISE NOTICE 'load_csv: % not found, leaving table % empty', loads[i][3], loads[i][1];
        ELSE
            EXECUTE format('COPY %I %s FROM %L WITH (FORMAT csv, HEADER true, ENCODING %L)',
                           loads[i][1], loads[i][2], path, 'UTF8');
        END IF;
    END LOOP;
END $$;

-- Keep the task-to-request-item relationship while preserving four exported
-- tasks whose referenced request items are absent from these CSVs.
ALTER TABLE sc_task
    ADD CONSTRAINT sc_task_request_item_fk
    FOREIGN KEY (request_item) REFERENCES sc_req_item(number) NOT VALID;

COMMIT;
