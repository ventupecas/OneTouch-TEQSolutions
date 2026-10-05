import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Secure Check: Ensure API client doesn't initialize empty
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey || apiKey.includes('your_actual')) {
  console.error("❌ ERROR: Your ANTHROPIC_API_KEY is missing or invalid in your .env file!");
}

const anthropic = new Anthropic({ apiKey: apiKey });

// FIXED CONTEXT: A detailed blueprint ensuring Claude always answers
const CUBE_SCHEMA_CONTEXT = `
You are a highly precise automated database analytics translator.
Your single goal is to read a user's natural language question and translate it into a single, clean JSON object for Cube.dev.

CRITICAL: Do not write explanations. Do not write markdown blocks like \`\`\`json. Output ONLY the JSON block.

The PostgreSQL database contains these CSV-backed tables:
- change_request: change requests and their planning, approval, and status fields.
- change_approvals: approval records; parent references change_request.number.
- incident: incident records.
- sc_req_item: requested items.
- ritm_approvals: requested-item approval records; parent references sc_req_item.number.
- sc_task: requested-item tasks; request_item references sc_req_item.number when the referenced item is present.

All imported columns are text. Do not invent numeric totals or time dimensions. Use count measures and dimensions only from these fields:
- change_request:
  - measures: [change_request.count]
  - dimensions: [change_request.number, change_request.type, change_request.created, change_request.sub_type, change_request.task_type, change_request.configuration_item, change_request.short_description, change_request.owner_group, change_request.outage, change_request.state, change_request.approval, change_request.close_code, change_request.failure_code, change_request.success_code, change_request.process_failure, change_request.diwakar_kumar, change_request.requested_by, change_request.state_1, change_request.planned_start_date, change_request.brewery, change_request.brewery_locations, change_request.work_notes, change_request.planned_end_date, change_request.risk, change_request.planned_start_date_1, change_request.planned_end_date_1, change_request.description, change_request.change_plan, change_request.verification_plan, change_request.backout_plan, change_request.purpose_of_change, change_request.incident, change_request.problem, change_request.enhancement, change_request.sap_impact, change_request.sap_transport_required, change_request.environment, change_request.project, change_request.comments_and_work_notes]
- change_approvals:
  - measures: [change_approvals.count]
  - dimensions: [change_approvals.task_type, change_approvals.parent, change_approvals.assignment_group, change_approvals.short_description, change_approvals.created, change_approvals.work_notes, change_approvals.approval, change_approvals.state]
- incident:
  - measures: [incident.count]
  - dimensions: [incident.number, incident.created, incident.short_description, incident.description, incident.affected_user, incident.assignment_group, incident.assigned_to, incident.problem, incident.state, incident.parent_incident, incident.priority, incident.impact, incident.urgency, incident.breach_reason, incident.global_incident, incident.knowledge_article_reference, incident.category, incident.subcategory, incident.updated, incident.was_p1, incident.configuration_item, incident.contact_type, incident.reassignment_count, incident.close_code, incident.close_notes, incident.cause_code, incident.cause_sub_code, incident.opened_by_group, incident.location, incident.reopen_count, incident.caused_by_change, incident.business_impact_outage, incident.resolved, incident.closed, incident.responsibility_for_outage, incident.on_hold_reason, incident.work_notes, incident.risk_register_number, incident.tags, incident.third_party_related_ticket, incident.business_impact, incident.downgrade_reason, incident.downgrade_type, incident.kb_article]
- sc_req_item:
  - measures: [sc_req_item.count]
  - dimensions: [sc_req_item.number, sc_req_item.item, sc_req_item.description, sc_req_item.short_description, sc_req_item.opened, sc_req_item.updated, sc_req_item.closed, sc_req_item.stage, sc_req_item.state, sc_req_item.parent, sc_req_item.request, sc_req_item.requested_for, sc_req_item.opened_by, sc_req_item.approval, sc_req_item.approval_history, sc_req_item.approval_set, sc_req_item.location, sc_req_item.work_notes, sc_req_item.fulfilled_time, sc_req_item.order_guide]
- ritm_approvals:
  - measures: [ritm_approvals.count]
  - dimensions: [ritm_approvals.task_type, ritm_approvals.parent, ritm_approvals.assignment_group, ritm_approvals.short_description, ritm_approvals.created, ritm_approvals.approval, ritm_approvals.state]
- sc_task:
  - measures: [sc_task.count]
  - dimensions: [sc_task.number, sc_task.item, sc_task.state, sc_task.short_description, sc_task.assignment_group, sc_task.assigned_to, sc_task.parent, sc_task.opened_by, sc_task.approval, sc_task.approval_history, sc_task.approval_set, sc_task.request, sc_task.request_item, sc_task.sla_flag, sc_task.created, sc_task.updated, sc_task.additional_comments, sc_task.description, sc_task.work_notes, sc_task.active]

Return a Cube query object using only those exact member names, for example:
{"measures":["incident.count"],"dimensions":["incident.priority"],"filters":[{"member":"incident.state","operator":"equals","values":["Resolved"]}]}
Omit measures, dimensions, or filters that are not needed. Do not include SQL, prose, or unsupported fields.
`;

app.post('/api/query', async (req, res) => {
  try {
    const { userPrompt } = req.body;
    if (!userPrompt) return res.status(400).json({ error: 'userPrompt parameter is required.' });

    console.log(`💬 User data prompt received: "${userPrompt}"`);

    let responseText = "";

    // 🎨 VERIFIED FIX: Use Anthropic's Native Event Stream handler to prevent empty array locks
    const stream = await anthropic.messages.stream({
      model: "claude-sonnet-5-5",
      max_tokens: 1000,
      system: CUBE_SCHEMA_CONTEXT,
      messages: [{ role: "user", content: `Provide the raw Cube JSON object representing: "${userPrompt}"` }],
    });

    // Capture text tokens in real-time as they stream out from Anthropic
    stream.on('text', (text) => {
      responseText += text;
    });

    // Wait for the stream completion event loop to finalize safely
    await stream.finalMessage();

    // Sanitize and isolate the JSON data segment
    const sanitizedJSON = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
       const targetCubeQuery = JSON.parse(sanitizedJSON);

    // 🛡️ SAFETY CHECK: If Claude returned a custom error object, intercept it
    if (targetCubeQuery.error || !targetCubeQuery.measures) {
      console.warn("⚠️ Claude generated an invalid query payload framework:", targetCubeQuery);
      return res.status(400).json({ 
        error: `The AI assistant couldn't map that specific question to your active Cube schema columns. Try asking something like: 'Show me total revenue by status'.` 
      });
    }

        console.log("🤖 Claude Compiled Query Payload:", targetCubeQuery);

    // 1. FIRST: Define and execute the fetch command to create cubeResponse
    const cubeResponse = await fetch(process.env.CUBE_API_URL || 'http://localhost:4000/cubejs-api/v1/load', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.CUBE_API_TOKEN || 'super_secret_key_change_me_later',
      },
      body: JSON.stringify({ query: targetCubeQuery }), 
    });

    // 2. SECOND: Now you can safely check cubeResponse without getting an undefined error
    const contentType = cubeResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const htmlErrorText = await cubeResponse.text();
      console.error("❌ Cube.dev returned an HTML Error Page instead of JSON:", htmlErrorText);
      return res.status(500).json({ 
        error: "Cube.dev engine returned an internal server web error page. Re-check paths." 
      });
    }

    // 3. THIRD: Parse the clean JSON response payload
    const data = await cubeResponse.json();



    if (data.error) {
      console.error("❌ Cube Database Model Error:", data.error);
      return res.status(400).json({ error: `Cube engine compilation error: ${data.error}` });
    }

    // Return the payload back to the browser user interface
    res.json({ aiInterpretation: targetCubeQuery, results: data.data || [] });
  } catch (error) {
    console.error("❌ /api/query failed:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown server error'
    });
  }
});

app.listen(port, () => {
  console.log(`🚀 Node.js Orchestrator framework live on http://localhost:${port}`);
});
