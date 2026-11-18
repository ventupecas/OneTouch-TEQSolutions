// =====================================================================
// THE OFFLINE VERSION'S MODEL (local_llm.mjs, docker-compose.local-ai.yml):
//   docker exec analytics_node_app npm run local-ai -- pull     download it (once)
//   docker exec analytics_node_app npm run local-ai -- status   is it there?
//   docker exec analytics_node_app npm run local-ai -- ask "How many open P1 incidents are there?"
// "ask" shows the query the local model writes for one question, with how
// long it took; it runs nothing in Cube and needs no account.
// =====================================================================

import dotenv from 'dotenv';

dotenv.config();
const { LOCAL_LLM_MODEL, LOCAL_LLM_URL, checkLocalModel, localChat, pullLocalModel } = await import('../local_llm.mjs');

const [command = 'status', ...rest] = process.argv.slice(2);

if (command === 'pull') {
  console.log(`Downloading ${LOCAL_LLM_MODEL} into Ollama (${LOCAL_LLM_URL})…`);
  let shown = '';
  // In a terminal the line updates in place; otherwise (docker exec, logs) every 25%
  const step = process.stdout.isTTY ? 1 : 25;
  await pullLocalModel(event => {
    const line = event.total ? `${event.status} ${Math.floor((100 * (event.completed || 0)) / event.total / step) * step}%` : event.status;
    if (line === shown) return;
    process.stdout.write(process.stdout.isTTY ? `\r${line.padEnd(60)}` : `${line}\n`);
    shown = line;
  });
  console.log(`\n✅ ${LOCAL_LLM_MODEL} is ready.`);
} else if (command === 'status') {
  console.log(await checkLocalModel());
} else if (command === 'ask') {
  const { buildSystemPrompt, buildUserMessage, normalizeAndValidate, OUTPUT_SCHEMA } = await import('../business_logic.mjs');
  const question = rest.join(' ');
  if (!question) throw new Error('Give a question: npm run local-ai -- ask "How many open incidents are there?"');
  const t = await localChat({ system: buildSystemPrompt(), messages: [{ role: 'user', content: buildUserMessage(question, new Date()) }], schema: OUTPUT_SCHEMA });
  const verdict = normalizeAndValidate(JSON.parse(t.text));
  console.log(JSON.stringify(verdict.ok ? { intent: verdict.intent, message: verdict.message, queries: verdict.queries } : { rejected: verdict.error }, null, 2));
  console.log(`${t.usage.input_tokens} tokens read, ${t.usage.output_tokens} written, ${(t.ms / 1000).toFixed(1)} s`);
} else {
  console.log('Use: npm run local-ai -- pull | status | ask "<question>"');
  process.exitCode = 1;
}
