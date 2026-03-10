// ═══════════════════════════════════════════
// CyberDeck - Power Manager
// ═══════════════════════════════════════════

const PowerModule = {
    async init() {
        const el = document.getElementById('mod-power');
        el.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">Power Manager</div>
                    <div class="module-subtitle">System resources & battery</div>
                </div>
                <button class="btn" id="lowPowerBtn" onclick="PowerModule.toggleLowPower()">Low Power Mode</button>
            </div>
            <div class="grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
                <div class="card"><h3 style="color:var(--cyan);margin-bottom:12px">🔋 Battery</h3><div id="battInfo">Loading...</div></div>
                <div class="card"><h3 style="color:var(--cyan);margin-bottom:12px">💾 Memory & CPU</h3><div id="memInfo">Loading...</div></div>
                <div class="card"><h3 style="color:var(--cyan);margin-bottom:12px">💿 Storage</h3><div id="storageInfo">Loading...</div></div>
                <div class="card"><h3 style="color:var(--cyan);margin-bottom:12px">🔧 Services</h3><div id="svcInfo">Loading...</div></div>
            </div>`;
        await this.refresh();
        this._interval = setInterval(() => this.refresh(), 10000);
    },

    async refresh() {
        this.loadBattery(); this.loadResources(); this.loadStorage(); this.loadServices();
    },

    async loadBattery() {
        try {
            const r = await authFetch(`${API}/api/power/battery`);
            const d = await r.json();
            if (!d.available) { document.getElementById('battInfo').innerHTML = `<p style="color:var(--text-dim)">${d.message || 'Install Termux:API'}</p>`; return; }
            const pct = d.percentage || 0;
            const color = pct > 50 ? 'var(--green)' : pct > 20 ? 'var(--yellow)' : 'var(--red)';
            document.getElementById('battInfo').innerHTML = `
                <div style="font-size:32px;font-weight:bold;color:${color}">${pct}%</div>
                <div class="power-bar"><div class="power-bar-fill" style="width:${pct}%;background:${color}"></div></div>
                <div style="margin-top:8px;font-size:13px;color:var(--text-dim)">${d.status || ''} · ${d.temperature ? d.temperature + '°C' : ''} · ${d.health || ''}</div>`;
        } catch { document.getElementById('battInfo').innerHTML = '<p style="color:var(--text-dim)">Unavailable</p>'; }
    },

    async loadResources() {
        try {
            const r = await authFetch(`${API}/api/power/resources`);
            const d = await r.json();
            const mp = d.memory.percent;
            document.getElementById('memInfo').innerHTML = `
                <div style="font-size:13px;margin-bottom:4px">RAM: ${mp}%</div>
                <div class="power-bar"><div class="power-bar-fill" style="width:${mp}%;background:${mp > 80 ? 'var(--red)' : 'var(--cyan)'}"></div></div>
                <div style="font-size:12px;color:var(--text-dim);margin-top:4px">${(d.memory.used / 1073741824).toFixed(1)}GB / ${(d.memory.total / 1073741824).toFixed(1)}GB</div>
                <div style="margin-top:12px;font-size:13px">CPUs: ${d.cpu.count} · Usage: ${d.cpu.usagePercent}%</div>
                <div style="font-size:12px;color:var(--text-dim)">Uptime: ${Math.floor(d.uptime / 3600)}h ${Math.floor((d.uptime % 3600) / 60)}m</div>`;
        } catch { document.getElementById('memInfo').innerHTML = '<p style="color:var(--text-dim)">Unavailable</p>'; }
    },

    async loadStorage() {
        try {
            const r = await authFetch(`${API}/api/power/storage`);
            const d = await r.json();
            if (!d.available) { document.getElementById('storageInfo').innerHTML = '<p style="color:var(--text-dim)">Unavailable</p>'; return; }
            const pct = parseInt(d.percent) || 0;
            document.getElementById('storageInfo').innerHTML = `
                <div style="font-size:13px;margin-bottom:4px">Used: ${d.percent}</div>
                <div class="power-bar"><div class="power-bar-fill" style="width:${pct}%;background:${pct > 85 ? 'var(--red)' : 'var(--cyan)'}"></div></div>
                <div style="font-size:12px;color:var(--text-dim);margin-top:4px">${d.used} / ${d.total} (${d.free} free)</div>`;
        } catch { document.getElementById('storageInfo').innerHTML = '<p style="color:var(--text-dim)">Unavailable</p>'; }
    },

    async loadServices() {
        try {
            const r = await authFetch(`${API}/api/power/services`);
            const d = await r.json();
            let html = '';
            for (const [k, s] of Object.entries(d)) {
                html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
                    <span style="width:8px;height:8px;border-radius:50%;background:${s.running ? 'var(--green)' : 'var(--red)'}"></span>
                    <span style="flex:1;font-size:13px">${s.label}</span>
                    <span style="font-size:11px;color:var(--text-dim)">${s.running ? 'Running' : 'Stopped'}</span>
                    ${s.heavy ? '<span class="tag tag-magenta">Heavy</span>' : ''}
                </div>`;
            }
            document.getElementById('svcInfo').innerHTML = html;
        } catch { }
    },

    lowPower: false,
    async toggleLowPower() {
        this.lowPower = !this.lowPower;
        try {
            const r = await authFetch(`${API}/api/power/low-power`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: this.lowPower }) });
            const d = await r.json();
            document.getElementById('lowPowerBtn').textContent = this.lowPower ? '🔋 Normal Mode' : 'Low Power Mode';
            alert(d.message);
            this.refresh();
        } catch (e) { alert('Error: ' + e.message); }
    }
};
