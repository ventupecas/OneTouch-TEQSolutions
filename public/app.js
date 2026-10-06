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
        // Fetch stream array data parameters directly from our Node Server Orchestrator
        const response = await fetch('http://localhost:8000/api/query', {
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
            // Start building a clean, responsive HTML table structure
            finalOutputString += `<div class="table-responsive"><table class="data-table"><thead><tr>`;
            
            // 1. DYNAMIC HEADERS: Extract column names from the first data row object
            const columns = Object.keys(data.results[0]);
            columns.forEach(col => {
                // Clean up the header text (e.g., convert "orders.total_revenue" to "Total Revenue")
                const cleanHeader = col.split('.').pop().replace(/_/g, ' ').toUpperCase();
                finalOutputString += `<th>${cleanHeader}</th>`;
            });
            finalOutputString += `</tr></thead><tbody>`;
            
            // 2. DYNAMIC ROWS: Populate the cells with dataset metrics
            data.results.forEach(row => {
                finalOutputString += `<tr>`;
                columns.forEach(col => {
                    let value = row[col];
                    // Format numbers neatly if applicable
                    if (!isNaN(value) && value.toString().indexOf('-') === -1 && value !== '') {
                        value = Number(value).toLocaleString();
                    }
                    finalOutputString += `<td>${value}</td>`;
                });
                finalOutputString += `</tr>`;
            });
            
            finalOutputString += `</tbody></table></div>`;
        } else {
            finalOutputString += `No exact matching transaction records were found for that selection window inside the database.`;
        }

        appendMessage('ai-msg', finalOutputString);
    } catch (error) {
        document.getElementById(loadingId)?.remove();
        appendMessage('ai-msg', `❌ Error: ${error.message}`);
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
