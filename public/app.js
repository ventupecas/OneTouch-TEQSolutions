// Tab Views Toggling Module
window.switchTab = function(viewName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));

    if (event && event.target) {
        event.target.classList.add('active');
    }
    const targetView = document.getElementById(`${viewName}-view`);
    if (targetView) targetView.classList.add('active');
};

// Asynchronous Chat Workflow Engine
window.sendPrompt = async function() {
    const inputField = document.getElementById('user-prompt');
    const chatLog = document.getElementById('chat-log');
    
    if (!inputField || !chatLog) return;
    const userPromptText = inputField.value.trim();

    if (!userPromptText) return;

    // Append User message node to DOM bubble UI
    appendMessage('user-msg', userPromptText);
    inputField.value = ''; // Reset input field immediately

    // Append standard generic loading sequence notification
    const loadingId = appendMessage('ai-msg', '🤖 Thinking and querying Cube.dev...');

    try {
        // 🎯 FIX: Force the explicit absolute localhost URL matching your Node port
        const response = await fetch('http://localhost:8000/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userPrompt: userPromptText })
        });

        const data = await response.json();
        
        const loadingElement = document.getElementById(loadingId);
        if (loadingElement) loadingElement.remove(); // Clear loading block

        if (data.error) {
            appendMessage('ai-msg', `❌ Error: ${data.error}`);
            return;
        }

        let finalOutputString = `<strong>Here is what I found:</strong><br><br>`;
        
        if (data.results && data.results.length > 0) {
            // Build a responsive HTML table structure
            finalOutputString += `<div class="table-responsive"><table class="data-table"><thead><tr>`;
            
            // 1. HEADERS: Extract keys from the first object row
            const columns = Object.keys(data.results[0]);
            columns.forEach(col => {
                const cleanHeader = col.split('.').pop().replace(/_/g, ' ').toUpperCase();
                finalOutputString += `<th>${cleanHeader}</th>`;
            });
            finalOutputString += `</tr></thead><tbody>`;
            
            // 2. ROWS: Populate table cells
            data.results.forEach(row => {
                finalOutputString += `<tr>`;
                columns.forEach(col => {
                    let value = row[col];
                    if (value === null || value === undefined) value = '';
                    if (!isNaN(value) && value !== '') {
                        value = Number(value).toLocaleString();
                    }
                    finalOutputString += `<td>${value}</td>`;
                });
                finalOutputString += `</tr>`;
            });
            
            finalOutputString += `</tbody></table></div>`;
        } else {
            finalOutputString += `No matching records were found for that query inside the database.`;
        }

        appendMessage('ai-msg', finalOutputString);

    } catch (err) {
        const loadingElement = document.getElementById(loadingId);
        if (loadingElement) loadingElement.remove();
        appendMessage('ai-msg', `❌ Could not complete request. Ensure your node server is running.`);
        console.error(err);
    }
};

// Element Node Builder Helper
function appendMessage(cssClass, text) {
    const chatLog = document.getElementById('chat-log');
    if (!chatLog) return;
    const msgBlock = document.createElement('div');
    const uniqueId = 'msg-' + Date.now();
    
    msgBlock.id = uniqueId;
    msgBlock.className = `msg ${cssClass}`;
    msgBlock.innerHTML = text;
    
    chatLog.appendChild(msgBlock);
    chatLog.scrollTop = chatLog.scrollHeight; // Auto-scroll to bottom
    return uniqueId;
}
