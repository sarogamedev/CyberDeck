// ═══════════════════════════════════════════
// CyberDeck - LLM Chat Module
// ═══════════════════════════════════════════

const LLMModule = {
    messages: [],
    models: [],
    selectedModel: '',
    isGenerating: false,
    useRag: true, // Default to true for better "out of box" experience

    async init() {
        const el = document.getElementById('mod-llm');
        el.innerHTML = `
            <div class="chat-container">
                <div class="module-header" style="flex-shrink:0">
                    <div>
                        <div class="module-title">AI Chat</div>
                        <div class="module-subtitle" id="llmStatus">Checking Ollama...</div>
                    </div>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <button class="btn btn-sm btn-outline" id="refreshModelsBtn" onclick="LLMModule.checkStatus()" title="Refresh Models">Refresh</button>
                        <button class="btn btn-sm ${this.useRag ? 'btn-primary' : 'btn-outline'}" id="ragToggleBtn" onclick="LLMModule.toggleRag()" title="Toggle Knowledge Base">
                            ${this.useRag ? '📚 Knowledge: ON' : '📖 Knowledge: OFF'}
                        </button>
                        <div class="model-selector">
                            <label>Model:</label>
                            <select id="modelSelect" onchange="LLMModule.selectedModel = this.value">
                                <option value="">Loading...</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="chat-messages" id="aiChatMessages">
                    <div class="chat-msg assistant">
                        <div class="msg-avatar">🤖</div>
                        <div class="msg-bubble">Hello! I'm your local AI assistant running on this device. Ask me anything!</div>
                    </div>
                </div>
                <div class="chat-input-area">
                    <textarea class="chat-input" id="aiChatInput" placeholder="Type a message..." rows="1"
                              onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault(); LLMModule.send()}"></textarea>
                    <button class="chat-send-btn" onclick="LLMModule.send()">➤</button>
                </div>
            </div>
        `;
        await this.checkStatus();
    },

    async checkStatus() {
        const btn = document.getElementById('refreshModelsBtn');
        if (btn) {
            btn.style.transition = 'transform 0.5s ease';
            btn.style.transform = 'rotate(360deg)';
        }
        try {
            const res = await authFetch(`${API}/api/llm/status`);
            const data = await res.json();
            const statusEl = document.getElementById('llmStatus');

            if (data.running) {
                statusEl.textContent = `Ollama running · ${data.models?.length || 0} models`;
                this.models = data.models || [];
                const select = document.getElementById('modelSelect');
                const current = select.value || this.selectedModel;

                select.innerHTML = this.models.map(m =>
                    `<option value="${escapeHtml(m.name)}" ${m.name === current ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
                ).join('') || '<option value="">No models</option>';

                this.selectedModel = select.value || (this.models[0]?.name || '');
                statusEl.style.color = '';
            } else {
                statusEl.textContent = 'Ollama not running — start it from Admin Panel';
                statusEl.style.color = 'var(--yellow)';
            }
        } catch (err) {
            document.getElementById('llmStatus').textContent = 'Cannot connect to server';
        }
        if (btn) {
            setTimeout(() => { btn.style.transform = 'rotate(0deg)'; }, 500);
        }
    },

    toggleRag() {
        this.useRag = !this.useRag;
        const btn = document.getElementById('ragToggleBtn');
        if (this.useRag) {
            btn.classList.replace('btn-outline', 'btn-primary');
            btn.textContent = '📚 Knowledge: ON';
        } else {
            btn.classList.replace('btn-primary', 'btn-outline');
            btn.textContent = '📖 Knowledge: OFF';
        }
    },

    async send() {
        const input = document.getElementById('aiChatInput');
        const text = input.value.trim();
        if (!text || this.isGenerating) return;

        input.value = '';
        this.isGenerating = true;

        // Add user message
        this.messages.push({ role: 'user', content: text });
        this.appendMessage('user', escapeHtml(text));

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
                    stream: true,
                    useRag: this.useRag
                })
            });

            if (this.useRag) {
                const statusEl = document.getElementById('llmStatus');
                const oldStatus = statusEl.textContent;
                statusEl.innerHTML = '<span class="status-dot pulse" style="background:var(--cyan)"></span> Searching local library...';
                setTimeout(() => { if(statusEl.textContent.includes('Searching')) statusEl.textContent = oldStatus; }, 3000);
            }

            // An error response is JSON, not an event stream. Without this the
            // loop consumed it, matched no "data: " lines and left the bubble
            // stuck on "Thinking..." with nothing shown to the user.
            if (!res.ok) {
                let detail = `HTTP ${res.status}`;
                try {
                    const errBody = await res.json();
                    if (errBody?.error) detail = errBody.error;
                } catch (e) { /* not JSON */ }
                throw new Error(detail);
            }
            if (!res.body) throw new Error('Streaming is not supported by this browser');

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';
            let carry = '';
            const bubble = document.getElementById(bubbleId);

            let streaming = true;
            while (streaming) {
                const { done, value } = await reader.read();
                if (done) break;

                // Server-sent events can split across network chunks; hold the
                // trailing partial line until the rest arrives.
                carry += decoder.decode(value, { stream: true });
                const parts = carry.split('\n');
                carry = parts.pop();

                for (const line of parts) {
                    if (!line.startsWith('data: ')) continue;
                    const dataStr = line.slice(6).trim();
                    if (dataStr === '[DONE]') { streaming = false; break; }
                    try {
                        const data = JSON.parse(dataStr);
                        if (data.error) throw new Error(data.error);
                        if (data.message?.content) {
                            fullResponse += data.message.content;
                            if (bubble) bubble.innerHTML = this.renderMarkdown(fullResponse);
                        }
                    } catch (e) {
                        if (e instanceof SyntaxError) continue; // partial or junk
                        throw e;
                    }
                }
            }

            if (!fullResponse && bubble) {
                bubble.innerHTML = '<span style="color:var(--text-dim)">No response from the model.</span>';
            }

            this.messages.push({ role: 'assistant', content: fullResponse });
        } catch (err) {
            const bubble = document.getElementById(bubbleId);
            if (bubble) bubble.innerHTML = `<span style="color:var(--red)">Error: ${escapeHtml(err.message)}</span>`;
        }

        this.isGenerating = false;
        this.scrollChat();
    },

    appendMessage(role, content, id) {
        const messagesEl = document.getElementById('aiChatMessages');
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
        const el = document.getElementById('aiChatMessages');
        el.scrollTop = el.scrollHeight;
    },

    renderMarkdown(text) {
        // Simple markdown rendering
        return text
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") // escape raw HTML first
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }
};

// Exposed on window so app.js cleanup and delegated handlers can reach it.
window.LLMModule = LLMModule;
