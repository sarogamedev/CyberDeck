// ═══════════════════════════════════════════
// CyberDeck - LLM Chat Module
// ═══════════════════════════════════════════

const LLMModule = {
    messages: [],
    models: [],
    selectedModel: '',
    isGenerating: false,

    async init() {
        const el = document.getElementById('mod-llm');
        el.innerHTML = `
            <div class="chat-container">
                <div class="module-header" style="flex-shrink:0">
                    <div>
                        <div class="module-title">AI Chat</div>
                        <div class="module-subtitle" id="llmStatus">Checking Ollama...</div>
                    </div>
                    <div class="model-selector">
                        <label>Model:</label>
                        <select id="modelSelect" onchange="LLMModule.selectedModel = this.value">
                            <option value="">Loading...</option>
                        </select>
                    </div>
                </div>
                <div class="chat-messages" id="chatMessages">
                    <div class="chat-msg assistant">
                        <div class="msg-avatar">🤖</div>
                        <div class="msg-bubble">Hello! I'm your local AI assistant running on this device. Ask me anything!</div>
                    </div>
                </div>
                <div class="chat-input-area">
                    <textarea class="chat-input" id="chatInput" placeholder="Type a message..." rows="1"
                              onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault(); LLMModule.send()}"></textarea>
                    <button class="chat-send-btn" onclick="LLMModule.send()">➤</button>
                </div>
            </div>
        `;
        await this.checkStatus();
    },

    async checkStatus() {
        try {
            const res = await authFetch(`${API}/api/llm/status`);
            const data = await res.json();
            const statusEl = document.getElementById('llmStatus');

            if (data.running) {
                statusEl.textContent = `Ollama running · ${data.models?.length || 0} models`;
                this.models = data.models || [];
                const select = document.getElementById('modelSelect');
                select.innerHTML = this.models.map(m =>
                    `<option value="${m.name}">${m.name}</option>`
                ).join('') || '<option value="">No models</option>';
                this.selectedModel = this.models[0]?.name || '';
            } else {
                statusEl.textContent = 'Ollama not running — start it from Admin Panel';
                statusEl.style.color = 'var(--yellow)';
            }
        } catch (err) {
            document.getElementById('llmStatus').textContent = 'Cannot connect to server';
        }
    },

    async send() {
        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text || this.isGenerating) return;

        input.value = '';
        this.isGenerating = true;

        // Add user message
        this.messages.push({ role: 'user', content: text });
        this.appendMessage('user', text);

        // Create assistant bubble
        const bubbleId = 'msg-' + Date.now();
        this.appendMessage('assistant', '<span style="opacity:0.5">Thinking...</span>', bubbleId);

        try {
            const res = await authFetch(`${API}/api/llm/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.selectedModel,
                    messages: this.messages,
                    stream: true
                })
            });

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';
            const bubble = document.getElementById(bubbleId);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

                for (const line of lines) {
                    const dataStr = line.replace('data: ', '');
                    if (dataStr === '[DONE]') break;
                    try {
                        const data = JSON.parse(dataStr);
                        if (data.message?.content) {
                            fullResponse += data.message.content;
                            bubble.innerHTML = this.renderMarkdown(fullResponse);
                        }
                    } catch (e) { /* skip */ }
                }
            }

            this.messages.push({ role: 'assistant', content: fullResponse });
        } catch (err) {
            const bubble = document.getElementById(bubbleId);
            bubble.innerHTML = `<span style="color:var(--red)">Error: ${err.message}</span>`;
        }

        this.isGenerating = false;
        this.scrollChat();
    },

    appendMessage(role, content, id) {
        const messagesEl = document.getElementById('chatMessages');
        const avatar = role === 'user' ? '👤' : '🤖';
        const msgEl = document.createElement('div');
        msgEl.className = `chat-msg ${role}`;
        msgEl.innerHTML = `
            <div class="msg-avatar">${avatar}</div>
            <div class="msg-bubble" ${id ? `id="${id}"` : ''}>${content}</div>
        `;
        messagesEl.appendChild(msgEl);
        this.scrollChat();
    },

    scrollChat() {
        const el = document.getElementById('chatMessages');
        el.scrollTop = el.scrollHeight;
    },

    renderMarkdown(text) {
        // Simple markdown rendering
        return text
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }
};
