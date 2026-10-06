import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

// 🎯 VERIFY THIS LINE: Make sure app.use(cors()) sits at the very top of your server.mjs
app.use(cors({ origin: '*' })); 
app.use(express.json());
app.use(express.static('public'));


const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CUBE_SCHEMA_CONTEXT = `
You are a highly precise database analytics translator.
Translate the user's question into a single, clean JSON object for Cube.dev.

CRITICAL FORMATTING RULES:
1. Do not include markdown code block syntax (like \`\`\`json). Output ONLY raw JSON text.
2. Never include "error" or "message" keys.
3. Crucial: The "order" property must be a nested array of strings, exactly like this: [["incident.created", "asc"]]

Available parameters:
- change_request:
  - measures: [change_request.count]
  - dimensions: [change_request.number, change_request.type, change_request.created, change_request.state, change_request.risk, change_request.description]
- sc_req_item:
  - measures: [sc_req_item.count]
  - dimensions: [sc_req_item.number, sc_req_item.item, sc_req_item.description, sc_req_item.opened, sc_req_item.state]
- incident:
  - measures: [incident.count]
  - dimensions: [incident.number, incident.created, incident.short_description, incident.description, incident.state, incident.priority, incident.category]

Example: If asked for the "10 oldest tickets still open", you must output:
{
  "dimensions": ["incident.number", "incident.created", "incident.short_description", "incident.state"],
  "filters": [{ "member": "incident.state", "operator": "equals", "values": ["open"] }],
  "order": [["incident.created", "asc"]],
  "limit": 10
}
`;

app.post('/api/query', async (req, res) => {
  try {
    const { userPrompt } = req.body;
    if (!userPrompt) return res.status(400).json({ error: 'userPrompt parameter is required.' });

    console.log(`💬 Processing prompt: "${userPrompt}"`);
    let responseText = "";

    const stream = await anthropic.messages.stream({
      model: "claude-sonnet-5-5",
      max_tokens: 1000,
      system: CUBE_SCHEMA_CONTEXT,
      messages: [{ role: "user", content: `Provide the raw Cube JSON object for: "${userPrompt}"` }],
    });

    stream.on('text', (text) => { responseText += text; });
    await stream.finalMessage();

    const sanitizedJSON = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const targetCubeQuery = JSON.parse(sanitizedJSON);

    console.log("🤖 Claude Compiled Query:", JSON.stringify(targetCubeQuery, null, 2));

       // 🛡️ Ensure the backup parameter bypasses IPv6 lookups as well
     // 🛡️ Ensure the default backup path targets port 4000, not 15432
     const cubeResponse = await fetch(process.env.CUBE_API_URL || 'http://docker.internal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.CUBE_API_TOKEN || 'super_secret_key_change_me_later',
      },
      body: JSON.stringify({ query: targetCubeQuery }),
    });

    const contentType = cubeResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const htmlError = await cubeResponse.text();
      console.error("❌ Cube.dev HTML Error Page:", htmlError);
      return res.status(500).json({ error: "Cube.dev returned an internal server error page." });
    }

    const data = await cubeResponse.json();
    if (data.error) {
      console.error("❌ Cube Database Error:", data.error);
      return res.status(400).json({ error: `Cube Engine Error: ${data.error}` });
    }

    res.json({ aiInterpretation: targetCubeQuery, results: data.data || [] });

  } catch (error) {
    console.error('📋 Execution Failure:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Node.js Orchestrator live on http://localhost:${port}`);
});
