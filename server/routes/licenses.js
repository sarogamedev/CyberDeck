const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

router.get('/', (req, res) => {
    const licensePath = path.join(__dirname, '..', '..', 'THIRD_PARTY_LICENSES.md');
    let content = 'No license file found.';
    try {
        content = fs.readFileSync(licensePath, 'utf-8');
    } catch (e) {
        console.error('[Licenses] Error reading license file:', e.message);
    }

    // Multi-pass markdown → HTML
    const lines = content.split(/\r?\n/);
    let html = '';
    let inTable = false;
    let isFirstTableRow = true;

    for (const line of lines) {
        // Heading
        if (line.startsWith('# ')) { html += `<h1>${line.slice(2)}</h1>`; continue; }
        if (line.startsWith('## ')) { html += `<h2>${line.slice(3)}</h2>`; continue; }

        // Table separator row (|---|---|)
        if (/^\|[\s\-:]+\|/.test(line) && !line.replace(/[\|\s\-:]/g, '').length) {
            continue; // skip separator
        }

        // Table row
        if (line.startsWith('|') && line.endsWith('|')) {
            const cells = line.split('|').slice(1, -1).map(c => c.trim());
            if (!inTable) {
                html += '<table>';
                inTable = true;
                isFirstTableRow = true;
            }
            if (isFirstTableRow) {
                html += '<thead><tr>' + cells.map(c => `<th>${applyInline(c)}</th>`).join('') + '</tr></thead><tbody>';
                isFirstTableRow = false;
            } else {
                html += '<tr>' + cells.map(c => `<td>${applyInline(c)}</td>`).join('') + '</tr>';
            }
            continue;
        }

        // Close table if we were in one
        if (inTable) { html += '</tbody></table>'; inTable = false; isFirstTableRow = true; }

        // Paragraph text
        if (line.trim()) {
            html += `<p>${applyInline(line)}</p>`;
        }
    }
    if (inTable) html += '</tbody></table>';

    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function applyInline(text) {
        text = escapeHtml(text);
        return text
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
                // Only allow http/https URLs
                if (!/^https?:\/\//i.test(url)) return escapeHtml(label);
                return `<a href="${url}" target="_blank">${label}</a>`;
            })
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CyberDeck - Third Party Licenses</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --primary: #ffaa00;
            --primary-glow: rgba(255, 170, 0, 0.3);
            --bg: #000000;
            --surface: #0c0c0c;
            --surface2: #161616;
            --border: #222222;
        }
        body {
            background: var(--bg);
            color: #e0e0e0;
            font-family: 'JetBrains Mono', 'Segoe UI', monospace;
            padding: 60px 24px;
            max-width: 1000px;
            margin: 0 auto;
            line-height: 1.6;
            position: relative;
            overflow-x: hidden;
        }
        /* Grid background */
        body::before {
            content: "";
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background-image: 
                linear-gradient(rgba(255, 170, 0, 0.05) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255, 170, 0, 0.05) 1px, transparent 1px);
            background-size: 50px 50px;
            z-index: -1;
            pointer-events: none;
        }
        /* Scanline effect */
        body::after {
            content: " ";
            display: block;
            position: fixed;
            top: 0; left: 0; bottom: 0; right: 0;
            background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
            z-index: 1000;
            background-size: 100% 4px, 3px 100%;
            pointer-events: none;
            opacity: 0.15;
        }
        h1 {
            color: var(--primary);
            font-size: 32px;
            margin-bottom: 12px;
            text-shadow: 0 0 10px var(--primary-glow);
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        h2 {
            color: var(--primary);
            font-size: 18px;
            margin-top: 48px;
            margin-bottom: 20px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border);
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        p {
            margin-bottom: 16px;
            font-size: 14px;
            color: #aaa;
        }
        table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            margin: 24px 0 40px 0;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 4px;
            overflow: hidden;
        }
        thead tr {
            background: var(--surface2);
        }
        th {
            padding: 16px;
            text-align: left;
            font-size: 11px;
            font-weight: 600;
            color: var(--primary);
            text-transform: uppercase;
            letter-spacing: 1.5px;
            border-bottom: 2px solid var(--border);
        }
        td {
            padding: 14px 16px;
            font-size: 13px;
            border-bottom: 1px solid var(--border);
            color: #ddd;
        }
        tbody tr {
            background: transparent;
            transition: background 0.2s;
        }
        tbody tr:hover {
            background: rgba(255, 170, 0, 0.05);
        }
        tbody tr:last-child td {
            border-bottom: none;
        }
        a {
            color: var(--primary);
            text-decoration: underline;
            transition: opacity 0.2s;
        }
        a:hover { opacity: 0.7; }
        strong { color: #fff; }
        .back-link {
            display: inline-block;
            margin-top: 60px;
            padding: 12px 24px;
            background: var(--surface2);
            border: 1px solid var(--primary);
            color: var(--primary);
            font-size: 13px;
            text-decoration: none;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            border-radius: 0;
            transition: all 0.2s;
            box-shadow: 0 0 10px var(--primary-glow);
        }
        .back-link:hover { 
            background: var(--primary); 
            color: #000;
            box-shadow: 0 0 20px var(--primary-glow);
        }
    </style>
</head>
<body>
    ${html}
    <a href="/" class="back-link">← Back to CyberDeck</a>
</body>
</html>`);
});

module.exports = router;
