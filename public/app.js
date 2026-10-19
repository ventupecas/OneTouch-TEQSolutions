// Tab Views Toggling Module
function switchTab(viewName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));

    event.target.classList.add('active');
    document.getElementById(`${viewName}-view`).classList.add('active');
}

// Asynchronous Chat Workflow Engine
async function sendPrompt() {
    const inputField = document.getElementById('user-prompt');
    const chatLog = document.getElementById('chat-log');
    const userPromptText = inputField.value.trim();
    console.log("User Prompt Text:", userPromptText);

    if (!userPromptText) return;

    // Append User message node to DOM bubble UI
    appendMessage('user-msg', userPromptText);
    inputField.value = '';

    // Append standard generic loading sequence notification
    const loadingId = appendMessage('ai-msg', '🤖 Thinking and querying Cube.dev...');

               try {
        // 🎯 FIX: Explicitly relative route path
        const response = await fetch('http://localhost:8000/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userPrompt: userPromptText })
        });

        console.log("THIS IS THE RESPONSE FROM THE SERVER:", response.status, response.statusText);

        const data = await response.json();


        document.getElementById(loadingId).remove(); // Clear loading block

        if (data.error) {
            appendMessage('ai-msg', `❌ Error: ${data.error}`);
            return;
        }

        // Clarification or unsupported question: show the explanation only
        if (data.intent === 'clarify' || data.intent === 'unsupported') {
            appendMessage('ai-msg', `🙋 ${escapeHtml(data.message || 'I need a little more detail to run that.')}`);
            return;
        }

        // Normal query: restate what was fetched, list assumptions, then the rows
        let finalOutputString = '';
        if (data.message) {
            finalOutputString += `<strong>${escapeHtml(data.message)}</strong><br>`;
        } else {
            finalOutputString += `<strong>Here is what I found:</strong><br>`;
        }
        if (data.assumptions && data.assumptions.length > 0) {
            finalOutputString += `<em>Assumptions:</em><ul>` +
                data.assumptions.map(a => `<li>${escapeHtml(a)}</li>`).join('') +
                `</ul>`;
        }
        finalOutputString += `<br>`;

        if (data.results && data.results.length > 0) {
            finalOutputString += `<pre>${escapeHtml(JSON.stringify(data.results, null, 2))}</pre>`;
        } else {
            finalOutputString += `No matching records were found for that question.`;
        }

        appendMessage('ai-msg', finalOutputString);

    } catch (err) {
        document.getElementById(loadingId).remove();
        appendMessage('ai-msg', `❌ Could not talk to backend server orchestration framework.`);
        console.error(err);
    }
}

// Escape text that came from the server or the model before inserting as HTML
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Element Node Builder Helper
function appendMessage(cssClass, text) {
    const chatLog = document.getElementById('chat-log');
    const msgBlock = document.createElement('div');
    const uniqueId = 'msg-' + Date.now();
    
    msgBlock.id = uniqueId;
    msgBlock.className = `msg ${cssClass}`;
    msgBlock.innerHTML = text;
    
    chatLog.appendChild(msgBlock);
    chatLog.scrollTop = chatLog.scrollHeight; // Keep log automatically scrolled to bottom
    return uniqueId;
}
