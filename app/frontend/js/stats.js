const StatsModule = {
  async init() {
    const container = document.getElementById('view-stats');
    container.innerHTML = '<div style="color:var(--color-text-dim);padding:24px">LOADING...</div>';
    try {
      const res = await fetch('/api/stats', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Failed to load stats');
      const s = await res.json();
      this._render(container, s);
    } catch (err) {
      container.innerHTML = `<div style="color:var(--color-red);padding:24px">${Utils.escape(err.message)}</div>`;
    }
  },

  _render(container, s) {
    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${s.files.count}</div>
          <div class="stat-label">FILES STORED</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Utils.formatBytes(s.files.total_bytes)}</div>
          <div class="stat-label">TOTAL SIZE</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${s.uploads.count}</div>
          <div class="stat-label">UPLOADS</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Utils.formatBytes(s.uploads.total_bytes)}</div>
          <div class="stat-label">BYTES UPLOADED</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${s.downloads.count}</div>
          <div class="stat-label">DOWNLOADS</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${s.expired.count}</div>
          <div class="stat-label">EXPIRED</div>
        </div>
      </div>
    `;
  },
};
