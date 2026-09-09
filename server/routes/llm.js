const express = require('express');

let fetch;
try { fetch = require('node-fetch'); } catch (e) { fetch = null; }

module.exports = function (config, rag) {
    const router = express.Router();
    const baseUrl = `http://localhost:${config.services.ollama.port}`;

    // Check if Ollama is running
    router.get('/status', async (req, res) => {
        try {
            if (!fetch) return res.json({ running: false, error: 'node-fetch not installed' });
            const response = await fetch(`${baseUrl}/api/tags`, { timeout: 3000 });
            const data = await response.json();
            res.json({ running: true, models: data.models || [] });
        } catch (err) {
            res.json({ running: false, error: err.message });
        }
    });

    // List available models
    router.get('/models', async (req, res) => {
        try {
            if (!fetch) return res.status(500).json({ error: 'node-fetch not installed' });
            const response = await fetch(`${baseUrl}/api/tags`);
            const data = await response.json();
            res.json(data.models || []);
        } catch (err) {
            res.status(500).json({ error: `Ollama not reachable: ${err.message}` });
        }
    });

    // Chat completion (streaming)
    router.post('/chat', async (req, res) => {
        try {
            if (!fetch) return res.status(500).json({ error: 'node-fetch not installed' });

            const { model, messages, stream = true, useRag = false } = req.body || {};

            // messages was used unchecked: a missing or non-array body threw on
            // the spread and on messages[messages.length - 1].content.
            if (!Array.isArray(messages) || messages.length === 0) {
                return res.status(400).json({ error: 'messages must be a non-empty array' });
            }
            if (messages.some(m => !m || typeof m.content !== 'string')) {
                return res.status(400).json({ error: 'each message needs a string content' });
            }

            const modelName = model || config.services.ollama.defaultModel || 'tinyllama';

            // 1. If RAG is enabled, get context.
            // Copy the last message rather than mutating the caller's object.
            let augmentedMessages = messages.map(m => ({ ...m }));
            if (useRag) {
                const lastMsg = augmentedMessages[augmentedMessages.length - 1].content;
                const context = await rag.getContext(lastMsg);
                if (context) {
                    augmentedMessages[augmentedMessages.length - 1].content =
                        `${context}\n\nUser Question: ${lastMsg}`;
                }
            }

            if (stream) {
                const response = await fetch(`${baseUrl}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: modelName, messages: augmentedMessages, stream: true })
                });

                // ... (streaming logic remains same)
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                const reader = response.body;

                // Ollama emits NDJSON, and TCP chunks split anywhere. Splitting
                // each chunk on its own silently dropped any token that
                // straddled a boundary, so a carry-over buffer holds the
                // trailing partial line until the rest arrives.
                let carry = '';
                reader.on('data', (chunk) => {
                    carry += chunk.toString();
                    const lines = carry.split('\n');
                    carry = lines.pop(); // Last element is the incomplete line.

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const data = JSON.parse(line);
                            res.write(`data: ${JSON.stringify(data)}\n\n`);
                            if (data.done) res.write('data: [DONE]\n\n');
                        } catch (e) {
                            console.warn('[LLM] Skipping unparseable stream line');
                        }
                    }
                });
                reader.on('end', () => {
                    // Flush anything left in the buffer at stream end.
                    if (carry.trim()) {
                        try {
                            const data = JSON.parse(carry);
                            res.write(`data: ${JSON.stringify(data)}\n\n`);
                        } catch (e) { /* trailing junk */ }
                    }
                    res.end();
                });
                reader.on('error', (err) => {
                    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
                    res.end();
                });
                req.on('close', () => reader.destroy());
            } else {
                const response = await fetch(`${baseUrl}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: modelName, messages: augmentedMessages, stream: false })
                });
                const data = await response.json();
                res.json(data);
            }
        } catch (err) {
            res.status(500).json({ error: `LLM error: ${err.message}` });
        }
    });

    // ... (rest of the code)

    // Generate (single prompt, no chat history)
    router.post('/generate', async (req, res) => {
        try {
            if (!fetch) return res.status(500).json({ error: 'node-fetch not installed' });
            const { model, prompt } = req.body;
            const modelName = model || config.services.ollama.defaultModel || 'tinyllama';

            const response = await fetch(`${baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: modelName, prompt, stream: false })
            });
            const data = await response.json();
            res.json(data);
        } catch (err) {
            res.status(500).json({ error: `LLM error: ${err.message}` });
        }
    });

    // Pull a model
    // Pulling a model downloads multiple GB and spawns work on the host. The
    // equivalent action in the content store already required admin approval.
    router.post('/pull', (req, res, next) => {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required to pull models' });
        }
        next();
    }, async (req, res) => {
        try {
            if (!fetch) return res.status(500).json({ error: 'node-fetch not installed' });
            const { model } = req.body;
            if (!model) return res.status(400).json({ error: 'Model name required' });

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');

            const response = await fetch(`${baseUrl}/api/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: model, stream: true })
            });

            response.body.on('data', (chunk) => {
                res.write(`data: ${chunk.toString()}\n\n`);
            });
            response.body.on('end', () => res.end());
            response.body.on('error', (err) => {
                res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
                res.end();
            });
        } catch (err) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
};
