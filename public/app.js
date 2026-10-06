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

    if (!userPromptText) return;

    // Append User message node to DOM bubble UI
    appendMessage('user-msg', userPromptText);
    inputField.value = '';

    // Append standard generic loading sequence notification
    const loadingId = appendMessage('ai-msg', '🤖 Thinking and querying Cube.dev...');

        try {
        // 🎯 FIX: Strip localhost out completely so it works seamlessly inside the Docker network context
        const response = await fetch('/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userPrompt: userPromptText })
        });

        const data = await response.json();

        document.getElementById(loadingId).remove(); // Clear loading block

        if (data.error) {
            appendMessage('ai-msg', `❌ Error: ${data.error}`);
            return;
        }

        // Parse result data arrays natively inside browser canvas logs
        let finalOutputString = `<strong>Here is what I found:</strong><br><br>`;
        
        if (data.results && data.results.length > 0) {
            finalOutputString += `<pre>${JSON.stringify(data.results, null, 2)}</pre>`;
        } else {
            finalOutputString += `No exact matching transaction records were found for that selection window inside the database.`;
        }

        appendMessage('ai-msg', finalOutputString);

    } catch (err) {
        document.getElementById(loadingId).remove();
        appendMessage('ai-msg', `❌ Could not talk to backend server orchestration framework.`);
        console.error(err);
    }
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
