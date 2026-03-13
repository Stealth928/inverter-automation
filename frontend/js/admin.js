
    // ==================== Admin Panel Logic ====================
    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    let currentUsers = [];
    let adminApiClient = null;
    let currentSort = { key: 'lastSignedInAt', direction: 'desc' };
    let platformTrendChart = null;
    let firestoreMetricsChart = null;
    let schedulerMetricsChart = null;
    let activeTab = 'overview';
    let tabsLoaded = { overview: false, scheduler: false, users: false };

    function showMessage(type, msg, duration = 5000) {
        const area = document.getElementById('messageArea');
        if (!area) return;
        const colors = {
            error: 'var(--color-danger)',
            success: 'var(--color-success)',
            warning: 'var(--color-warning)',
            info: 'var(--accent-blue)'
        };
        area.innerHTML = `<div style="padding: 10px 16px; border-radius: var(--radius-lg); background: ${colors[type] || colors.info}15; border: 1px solid ${colors[type] || colors.info}40; color: ${colors[type] || colors.info}; font-size: 13px; margin-bottom: 12px;">${msg}</div>`;
        if (duration > 0) {
            setTimeout(() => { area.innerHTML = ''; }, duration);
        }
    }

    function formatDate(ts) {
        if (!ts) return '-';
        try {
            const d = ts.toDate ? ts.toDate() : new Date(ts._seconds ? ts._seconds * 1000 : ts);
            if (isNaN(d.getTime())) return '-';
            return d.toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch { return '-'; }
    }

    function toComparableTimestamp(value) {
        if (!value) return 0;
        if (typeof value === 'string') {
            const t = Date.parse(value);
            return Number.isNaN(t) ? 0 : t;
        }
        if (value.toDate && typeof value.toDate === 'function') {
            const d = value.toDate();
            return d && d.getTime ? d.getTime() : 0;
        }
        if (value._seconds) return value._seconds * 1000;
        if (value.seconds) return value.seconds * 1000;
        if (typeof value === 'number') return value;
        const fallback = new Date(value).getTime();
        return Number.isNaN(fallback) ? 0 : fallback;
    }

    function isUserConfigured(user) {
        if (typeof user?.configured === 'boolean') return user.configured;
        return !!(user?.profileInitialized || Number(user?.rulesCount || 0) > 0 || (user?.hasDeviceSn && user?.hasFoxessToken));
    }

    function getSortValue(user, key) {
        switch (key) {
            case 'email': return (user.email || '').toLowerCase();
            case 'role': return (user.role || 'user').toLowerCase();
            case 'configured': return isUserConfigured(user) ? 1 : 0;
            case 'automationEnabled': return user.automationEnabled ? 1 : 0;
            case 'joinedAt': return toComparableTimestamp(user.joinedAt || user.createdAt);
            case 'lastSignedInAt': return toComparableTimestamp(user.lastSignedInAt);
            case 'rulesCount': return Number(user.rulesCount || 0);
            case 'actions': return (user.email || user.uid || '').toLowerCase();
            default: return (user.email || '').toLowerCase();
        }
    }

    function sortUsers(users) {
        const sorted = [...users].sort((a, b) => {
            const av = getSortValue(a, currentSort.key);
            const bv = getSortValue(b, currentSort.key);
            let cmp = 0;
            if (typeof av === 'string' || typeof bv === 'string') {
                cmp = String(av).localeCompare(String(bv));
            } else {
                cmp = av - bv;
            }
            if (cmp === 0) {
                // Stable tie-breaker by email
                cmp = String(a.email || '').localeCompare(String(b.email || ''));
            }
            return currentSort.direction === 'asc' ? cmp : -cmp;
        });
        return sorted;
    }

    function sortBy(key) {
        if (currentSort.key === key) {
            currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.key = key;
            currentSort.direction = 'asc';
        }
        renderUsersTable(currentUsers);
    }

    function sortIcon(key) {
        if (currentSort.key !== key) return '↕';
        return currentSort.direction === 'asc' ? '↑' : '↓';
    }

    // ==================== Tab Switching ====================
    function switchTab(name) {
        activeTab = name;
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
        if (!tabsLoaded[name]) {
            tabsLoaded[name] = true;
            if (name === 'overview') {
                loadPlatformStats();
                loadFirestoreCostMetrics();
            } else if (name === 'scheduler') {
                loadSchedulerMetrics();
            } else if (name === 'users') {
                loadUsers();
            }
        }
    }

    // ==================== Admin Check ====================
    async function checkAdminAccess() {
        try {
            const resp = await adminApiClient.fetch('/api/admin/check');
            const data = await resp.json();
            if (data.errno === 0 && data.result?.isAdmin) {
                document.getElementById('adminContent').style.display = '';
                document.getElementById('accessDenied').style.display = 'none';
                switchTab('overview');
            } else {
                document.getElementById('adminContent').style.display = 'none';
                document.getElementById('accessDenied').style.display = '';
            }
        } catch (e) {
            console.error('[Admin] Access check failed:', e);
            document.getElementById('adminContent').style.display = 'none';
            document.getElementById('accessDenied').style.display = '';
        }
    }

    // ==================== Load Users ====================
    async function loadUsers() {
        const loading = document.getElementById('usersLoading');
        const tableWrapper = document.getElementById('usersTableWrapper');
        loading.style.display = '';
        tableWrapper.style.display = 'none';

        try {
            const resp = await adminApiClient.fetch('/api/admin/users');
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Failed to load users');

            currentUsers = data.result.users || [];
            renderUsersTable(currentUsers);
            updatePlatformStats(currentUsers);

            loading.style.display = 'none';
            tableWrapper.style.display = '';
        } catch (e) {
            console.error('[Admin] Failed to load users:', e);
            loading.innerHTML = `<span style="color: var(--color-danger);">Failed to load users: ${e.message}</span>`;
        }
    }

    function refreshAdminData() {
        tabsLoaded[activeTab] = false;
        switchTab(activeTab);
    }

    async function loadPlatformStats() {
        try {
            const resp = await adminApiClient.fetch('/api/admin/platform-stats?days=90');
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Failed to load platform stats');

            const summary = data.result?.summary || {};
            const trend = Array.isArray(data.result?.trend) ? data.result.trend : [];

            document.getElementById('statTotalUsers').textContent = Number(summary.totalUsers || 0);
            document.getElementById('statConfigured').textContent = Number(summary.configuredUsers || 0);
            document.getElementById('statMAU').textContent = Number(summary.mau ?? summary.admins ?? 0);
            document.getElementById('statAutomationActive').textContent = Number(summary.automationActive || 0);

            renderPlatformTrendChart(trend);
        } catch (e) {
            console.error('[Admin] Failed to load platform stats:', e);
            showMessage('warning', `⚠️ Failed to load trend stats: ${e.message}`);
        }
    }

    function renderPlatformTrendChart(trend) {
        const canvas = document.getElementById('platformTrendChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const labels = trend.map(point => {
            const d = new Date(point.date + 'T00:00:00Z');
            return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
        });
        const totalUsers = trend.map(point => Number(point.totalUsers || 0));
        const configuredUsers = trend.map(point => Number(point.configuredUsers || 0));
        const usersWithRules = trend.map(point => Number(point.usersWithRules || 0));
        const deletedUsers = trend.map(point => Number(point.deletedUsers || 0));

        if (platformTrendChart) {
            platformTrendChart.destroy();
            platformTrendChart = null;
        }

        platformTrendChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Total Users',
                        data: totalUsers,
                        backgroundColor: 'rgba(88, 166, 255, 0.28)',
                        borderColor: 'rgba(88, 166, 255, 0.7)',
                        borderWidth: 1,
                        borderRadius: 4,
                        barPercentage: 0.9,
                        categoryPercentage: 0.95,
                        order: 1
                    },
                    {
                        type: 'line',
                        label: 'Configured Users',
                        data: configuredUsers,
                        borderColor: 'rgba(126, 231, 135, 0.95)',
                        backgroundColor: 'rgba(126, 231, 135, 0.15)',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 3,
                        tension: 0.25,
                        fill: false,
                        order: 0
                    },
                    {
                        type: 'line',
                        label: 'Users with Rules',
                        data: usersWithRules,
                        borderColor: 'rgba(240, 136, 62, 0.95)',
                        backgroundColor: 'rgba(240, 136, 62, 0.18)',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 3,
                        tension: 0.25,
                        fill: false,
                        order: 0
                    },
                    {
                        type: 'line',
                        label: 'Deleted Users',
                        data: deletedUsers,
                        borderColor: 'rgba(248, 81, 73, 0.95)',
                        backgroundColor: 'rgba(248, 81, 73, 0.15)',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 3,
                        tension: 0.25,
                        fill: false,
                        order: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        labels: {
                            color: cssVar('--text-secondary'),
                            boxWidth: 12,
                            usePointStyle: true,
                            pointStyle: 'rectRounded'
                        }
                    },
                    tooltip: {
                        backgroundColor: cssVar('--bg-secondary'),
                        borderColor: cssVar('--border-primary'),
                        borderWidth: 1,
                        titleColor: cssVar('--text-primary'),
                        bodyColor: cssVar('--text-secondary')
                    }
                },
                scales: {
                    x: {
                        ticks: { color: cssVar('--text-secondary'), maxTicksLimit: 12 },
                        grid: { color: cssVar('--border-secondary') }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: cssVar('--text-secondary'),
                            precision: 0
                        },
                        grid: { color: cssVar('--border-secondary') }
                    }
                }
            }
        });
    }

    // ==================== Render Users Table ====================
    function renderUsersTable(users) {
        const tableWrapper = document.getElementById('usersTableWrapper');
        const table = tableWrapper.querySelector('table.users-table');
        const thead = table.querySelector('thead');
        const tbody = document.getElementById('usersTableBody');

        thead.innerHTML = `
            <tr>
                <th class="sortable" onclick="sortBy('email')">User <span class="sort-indicator">${sortIcon('email')}</span></th>
                <th class="sortable" onclick="sortBy('role')">Role <span class="sort-indicator">${sortIcon('role')}</span></th>
                <th class="sortable" onclick="sortBy('configured')">Configured <span class="sort-indicator">${sortIcon('configured')}</span></th>
                <th class="sortable" onclick="sortBy('automationEnabled')">Automation <span class="sort-indicator">${sortIcon('automationEnabled')}</span></th>
                <th class="sortable" onclick="sortBy('joinedAt')">Joined <span class="sort-indicator">${sortIcon('joinedAt')}</span></th>
                <th class="sortable" onclick="sortBy('lastSignedInAt')">Last Signed In <span class="sort-indicator">${sortIcon('lastSignedInAt')}</span></th>
                <th class="sortable" onclick="sortBy('rulesCount')">Rules <span class="sort-indicator">${sortIcon('rulesCount')}</span></th>
                <th class="sortable" onclick="sortBy('actions')">Actions <span class="sort-indicator">${sortIcon('actions')}</span></th>
            </tr>
        `;

        if (!users.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--text-secondary); padding: 30px;">No users found</td></tr>';
            return;
        }

        const sorted = sortUsers(users);

        tbody.innerHTML = sorted.map(u => {
            const roleBadge = u.role === 'admin'
                ? '<span class="role-badge admin">🛡️ Admin</span>'
                : '<span class="role-badge user">👤 User</span>';

            const configured = isUserConfigured(u);
            const automationStatus = u.automationEnabled
                ? '<span class="status-dot active"></span>Active'
                : '<span class="status-dot inactive"></span>Inactive';
            const configuredStatus = configured
                ? '<span class="config-status yes" title="Configured">&#10003;</span>'
                : '<span class="config-status no" title="Not configured">&#10007;</span>';

            const roleAction = u.role === 'admin'
                ? `<button class="action-btn danger" onclick="setRole('${u.uid}', 'user')" title="Demote to user">Demote</button>`
                : `<button class="action-btn success" onclick="setRole('${u.uid}', 'admin')" title="Promote to admin">Promote</button>`;

            return `<tr>
                <td class="email-cell" title="${u.email}">${u.email || '<em>No email</em>'}</td>
                <td>${roleBadge}</td>
                <td>${configuredStatus}</td>
                <td>${automationStatus}</td>
                <td>${formatDate(u.joinedAt || u.createdAt)}</td>
                <td>${formatDate(u.lastSignedInAt)}</td>
                <td>${Number(u.rulesCount || 0)}</td>
                <td>
                    <div class="actions-cell">
                        <button class="action-btn" onclick="viewStats('${u.uid}', '${(u.email || '').replace(/'/g, '')}')">📊 Stats</button>
                        <button class="action-btn" onclick="impersonateUser('${u.uid}', '${(u.email || '').replace(/'/g, '')}')">👁️ View As</button>
                        ${roleAction}
                        <button class="action-btn danger" onclick="deleteUserByAdmin('${u.uid}', '${(u.email || '').replace(/'/g, '')}')">Delete</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    async function deleteUserByAdmin(uid, email) {
        const label = email || uid;
        const first = confirm(`Delete user "${label}" and all Firestore/Auth data permanently?`);
        if (!first) return;
        const confirmText = window.prompt('Type DELETE to confirm user deletion:');
        if (confirmText !== 'DELETE') {
            showMessage('warning', 'Deletion cancelled (confirmation text did not match)');
            return;
        }

        try {
            const resp = await adminApiClient.fetch(`/api/admin/users/${uid}/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmText: 'DELETE' })
            });
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data || data.errno !== 0) {
                throw new Error(data && data.error ? data.error : `Delete failed (${resp.status})`);
            }
            showMessage('success', `✅ Deleted user ${label}`);
            refreshAdminData();
        } catch (e) {
            showMessage('error', `❌ Failed to delete user: ${e.message || e}`);
        }
    }

    function formatCompactNumber(n) {
        const num = Number(n || 0);
        if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
        if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
        return String(Math.round(num));
    }

    function formatMetricWarning(text) {
        const raw = String(text || '').trim();
        if (!raw) return '';
        const short = raw.replace(/\s*If a metric was created recently[\s\S]*$/i, '').trim();
        return short.length > 160 ? `${short.slice(0, 157)}...` : short;
    }

    function renderFirestoreMetricsChart(trend) {
        const canvas = document.getElementById('firestoreMetricsChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const sorted = Array.isArray(trend) ? trend.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) : [];
        const labels = sorted.map((point) => {
            const d = new Date(point.timestamp);
            return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
        });

        const reads = sorted.map((point) => Number(point.reads || 0));
        const writes = sorted.map((point) => Number(point.writes || 0));
        const deletes = sorted.map((point) => Number(point.deletes || 0));

        if (firestoreMetricsChart) {
            firestoreMetricsChart.destroy();
            firestoreMetricsChart = null;
        }

        firestoreMetricsChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Reads',
                        data: reads,
                        borderColor: 'rgba(88, 166, 255, 0.95)',
                        backgroundColor: 'rgba(88, 166, 255, 0.12)',
                        borderWidth: 1.8,
                        pointRadius: 0,
                        tension: 0.2
                    },
                    {
                        label: 'Writes',
                        data: writes,
                        borderColor: 'rgba(126, 231, 135, 0.95)',
                        backgroundColor: 'rgba(126, 231, 135, 0.12)',
                        borderWidth: 1.8,
                        pointRadius: 0,
                        tension: 0.2
                    },
                    {
                        label: 'Deletes',
                        data: deletes,
                        borderColor: 'rgba(240, 136, 62, 0.95)',
                        backgroundColor: 'rgba(240, 136, 62, 0.12)',
                        borderWidth: 1.8,
                        pointRadius: 0,
                        tension: 0.2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        labels: {
                            color: cssVar('--text-secondary'),
                            boxWidth: 12,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: cssVar('--text-secondary'), maxTicksLimit: 10 },
                        grid: { color: cssVar('--border-secondary') }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: cssVar('--text-secondary'), precision: 0 },
                        grid: { color: cssVar('--border-secondary') }
                    }
                }
            }
        });
    }

    async function loadFirestoreCostMetrics() {
        const updatedEl = document.getElementById('firestoreMetricsUpdated');
        const warningEl = document.getElementById('firestoreMetricsWarning');
        const refreshBtn = document.getElementById('refreshFirestoreBtn');
        if (!adminApiClient || !updatedEl || !warningEl) return;

        if (refreshBtn) refreshBtn.disabled = true;
        updatedEl.textContent = 'Loading usage from GCP Monitoring...';
        warningEl.style.display = 'none';
        warningEl.textContent = '';

        try {
            const resp = await adminApiClient.fetch('/api/admin/firestore-metrics?hours=36');
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Failed to load Firestore metrics');

            const firestore = data.result?.firestore || {};
            const billing = data.result?.billing || {};
            const trend = Array.isArray(data.result?.trend) ? data.result.trend : [];
            const warnings = Array.isArray(data.result?.warnings) ? data.result.warnings : [];

            const docOpsEstimatedCostUsd = firestore.estimatedDocOpsCostUsd;
            const docOpsBreakdown = Array.isArray(firestore.estimatedDocOpsBreakdown) ? firestore.estimatedDocOpsBreakdown : [];
            const hasDocOpsEstimatedCost = docOpsEstimatedCostUsd !== null && docOpsEstimatedCostUsd !== undefined && Number.isFinite(Number(docOpsEstimatedCostUsd));
            const hasStorage = firestore.storageGb !== null && firestore.storageGb !== undefined && Number.isFinite(Number(firestore.storageGb));
            const projectMtdCostUsd = (billing.projectMtdCostUsd !== undefined) ? billing.projectMtdCostUsd : billing.estimatedMtdCostUsd;
            const projectServices = Array.isArray(billing.projectServices) ? billing.projectServices : billing.services;
            const projectCostIsEstimate = (billing.projectCostIsEstimate !== undefined) ? (billing.projectCostIsEstimate === true) : (billing.isEstimate === true);
            const projectCostSourceRaw = (billing.projectCostSource !== undefined) ? billing.projectCostSource : billing.costSource;
            const projectCostSource = String(projectCostSourceRaw || '').toLowerCase();
            const hasProjectCost = projectMtdCostUsd !== null && projectMtdCostUsd !== undefined && Number.isFinite(Number(projectMtdCostUsd));
            const shouldFallbackToDocOps = !hasProjectCost && hasDocOpsEstimatedCost;
            const effectiveProjectCostUsd = hasProjectCost
                ? Number(projectMtdCostUsd)
                : (shouldFallbackToDocOps ? Number(docOpsEstimatedCostUsd) : null);
            const effectiveProjectCostSource = hasProjectCost
                ? projectCostSource
                : (shouldFallbackToDocOps ? 'firestore-doc-ops-estimate' : projectCostSource);
            const hasEffectiveProjectCost = Number.isFinite(effectiveProjectCostUsd);
            const isDocOpsOnlyProjectCost = effectiveProjectCostSource === 'firestore-doc-ops-estimate';
            const projectCostApproximate = projectCostIsEstimate || shouldFallbackToDocOps || isDocOpsOnlyProjectCost;

            document.getElementById('firestoreReadsMtd').textContent = formatCompactNumber(firestore.readsMtd || 0);
            document.getElementById('firestoreWritesMtd').textContent = formatCompactNumber(firestore.writesMtd || 0);
            document.getElementById('firestoreDeletesMtd').textContent = formatCompactNumber(firestore.deletesMtd || 0);
            const storageEl = document.getElementById('firestoreStorageGb');
            if (storageEl) {
                storageEl.textContent = hasStorage
                    ? Number(firestore.storageGb).toFixed(3)
                    : 'Unavailable';
                storageEl.title = hasStorage
                    ? 'Approximate Firestore storage from Cloud Monitoring.'
                    : 'Firestore storage metric unavailable for this project/region.';
            }
            const projectCostEl = document.getElementById('firestoreProjectMtdCost');
            const projectBreakdownEl = document.getElementById('firestoreProjectServiceBreakdown');
            if (projectCostEl) {
                if (hasEffectiveProjectCost) {
                    const prefix = projectCostApproximate ? '~' : '';
                    const suffix = isDocOpsOnlyProjectCost ? '*' : '';
                    projectCostEl.textContent = `${prefix}$${Number(effectiveProjectCostUsd).toFixed(2)}${suffix}`;
                    projectCostEl.title = isDocOpsOnlyProjectCost
                        ? 'Firestore doc-op-only estimate (reads/writes/deletes). Excludes storage, egress, Functions, and other services.'
                        : (projectCostApproximate
                            ? 'Estimated/derived project-level MTD cost (Cloud Monitoring fallback may be delayed and approximate).'
                            : 'Project-level MTD cost from Cloud Billing API.');
                } else {
                    projectCostEl.textContent = 'Unavailable';
                    projectCostEl.title = 'Project-level billing metrics unavailable for this project.';
                }
            }

            if (projectBreakdownEl) {
                if (isDocOpsOnlyProjectCost && hasEffectiveProjectCost) {
                    projectBreakdownEl.textContent = '* Firestore doc-op estimate only (reads/writes/deletes).';
                    projectBreakdownEl.style.display = '';
                } else if (hasEffectiveProjectCost && Array.isArray(projectServices) && projectServices.length > 0) {
                    const parts = projectServices
                        .sort((a, b) => b.costUsd - a.costUsd)
                        .map((entry) => {
                            const label = String(entry.service || '')
                                .replace('Cloud Firestore', 'Firestore')
                                .replace('Cloud Functions', 'Functions')
                                .replace(/^Cloud /, '');
                            return `${label}: $${Number(entry.costUsd || 0).toFixed(2)}`;
                        });
                    projectBreakdownEl.textContent = parts.join(' · ');
                    projectBreakdownEl.style.display = '';
                } else {
                    projectBreakdownEl.textContent = '';
                    projectBreakdownEl.style.display = 'none';
                }
            }

            const docOpsCostEl = document.getElementById('firestoreDocOpsCost');
            const docOpsBreakdownEl = document.getElementById('firestoreDocOpsBreakdown');
            const docOpsTileEl = docOpsCostEl ? docOpsCostEl.closest('.firestore-kpi') : null;
            if (docOpsTileEl) {
                docOpsTileEl.style.display = isDocOpsOnlyProjectCost ? 'none' : '';
            }
            if (docOpsCostEl) {
                if (hasDocOpsEstimatedCost) {
                    docOpsCostEl.textContent = `~$${Number(docOpsEstimatedCostUsd).toFixed(2)}`;
                    docOpsCostEl.title = 'Firestore read/write/delete estimate only. Excludes storage, egress, Functions, and other services.';
                } else {
                    docOpsCostEl.textContent = 'Unavailable';
                    docOpsCostEl.title = 'Firestore doc-op estimate unavailable.';
                }
            }

            if (docOpsBreakdownEl) {
                if (hasDocOpsEstimatedCost && docOpsBreakdown.length > 0) {
                    const parts = docOpsBreakdown
                        .sort((a, b) => b.costUsd - a.costUsd)
                        .map((entry) => {
                            const label = String(entry.service || '')
                                .replace('Cloud Firestore', 'Firestore')
                                .replace(/^Firestore /, '');
                            return `${label}: $${Number(entry.costUsd || 0).toFixed(2)}`;
                        });
                    docOpsBreakdownEl.textContent = parts.join(' · ');
                    docOpsBreakdownEl.style.display = '';
                } else {
                    docOpsBreakdownEl.textContent = '';
                    docOpsBreakdownEl.style.display = 'none';
                }
            }

            const updatedAt = data.result?.updatedAt ? new Date(data.result.updatedAt) : new Date();
            const expectedUnavailablePattern = /unavailable for this project\/region|not available for this project\/billing setup/i;
            const billingIamPattern = /BILLING_IAM:/i;
            const formattedWarnings = warnings.map(formatMetricWarning).filter(Boolean);
            const iamWarnings = formattedWarnings.filter((w) => billingIamPattern.test(w));
            const actionableWarnings = formattedWarnings.filter((w) => !expectedUnavailablePattern.test(w) && !billingIamPattern.test(w));
            const suppressedCount = formattedWarnings.length - actionableWarnings.length - iamWarnings.length;

            const partialSuffix = suppressedCount > 0 ? ' · partial data' : '';
            updatedEl.textContent = `Last updated ${updatedAt.toLocaleDateString('en-AU')} ${updatedAt.toLocaleTimeString('en-AU')} · data source: ${data.result?.source || 'gcp-monitoring'}${partialSuffix}`;

            const allShownWarnings = [
                ...iamWarnings.map(w => '⚠️ IAM setup needed: ' + w.replace('BILLING_IAM: ', '')),
                ...actionableWarnings
            ];
            if (allShownWarnings.length) {
                warningEl.style.display = '';
                warningEl.textContent = allShownWarnings.join(' · ');
            }

            renderFirestoreMetricsChart(trend);
        } catch (e) {
            updatedEl.textContent = 'Unable to load Firestore usage from GCP Monitoring';
            warningEl.style.display = '';
            warningEl.textContent = e.message || String(e);
            showMessage('warning', `⚠️ Firestore metrics unavailable: ${e.message || e}`);
        } finally {
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }

    function formatDurationMs(durationMs) {
        const ms = Number(durationMs || 0);
        if (!Number.isFinite(ms) || ms <= 0) return '0ms';
        if (ms < 1000) return `${Math.round(ms)}ms`;
        const seconds = ms / 1000;
        if (seconds < 60) return `${seconds.toFixed(1)}s`;
        const minutes = Math.floor(seconds / 60);
        const remSeconds = Math.round(seconds % 60);
        return `${minutes}m ${remSeconds}s`;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function computeWeightedRunAverageMs(runs, statsKey) {
        const list = Array.isArray(runs) ? runs : [];
        let weightedTotalMs = 0;
        let totalSamples = 0;
        list.forEach((run) => {
            const stats = run && typeof run === 'object' ? run[statsKey] : null;
            const avgMs = Number(stats?.avgMs || 0);
            const count = Number(stats?.count || 0);
            if (!Number.isFinite(avgMs) || !Number.isFinite(count) || avgMs < 0 || count <= 0) return;
            weightedTotalMs += avgMs * count;
            totalSamples += count;
        });
        if (totalSamples <= 0) {
            return { avgMs: 0, sampleCount: 0 };
        }
        return {
            avgMs: weightedTotalMs / totalSamples,
            sampleCount: totalSamples
        };
    }

    function classifySchedulerSloLevel(value, target) {
        const measured = Number(value || 0);
        const threshold = Number(target || 0);
        if (!Number.isFinite(measured) || !Number.isFinite(threshold) || threshold <= 0) {
            return { level: 'warn', label: 'No data' };
        }
        if (measured <= threshold) {
            return { level: 'good', label: 'Healthy' };
        }
        if (measured <= threshold * 2) {
            return { level: 'warn', label: 'Watch' };
        }
        return { level: 'bad', label: 'Breach' };
    }

    function renderSchedulerSloCards(summary, options = {}) {
        const cyclesRun = Number(summary?.cyclesRun || 0);
        const deadLetters = Number(summary?.deadLetters || 0);
        const errorRatePct = Number(summary?.errorRatePct || 0);
        const deadLetterRatePct = cyclesRun > 0 ? (deadLetters / cyclesRun) * 100 : 0;
        const maxQueueLagMs = Number(summary?.maxQueueLagMs || 0);
        const maxCycleDurationMs = Number(summary?.maxCycleDurationMs || 0);
        const maxTelemetryAgeMs = Number(summary?.maxTelemetryAgeMs || 0);
        const p99CycleDurationMs = Number(summary?.p99CycleDurationMs || 0);
        const avgQueueLagMs = Number(options?.avgQueueLagMs || 0);
        const avgCycleDurationMs = Number(options?.avgCycleDurationMs || 0);
        const thresholds = options?.thresholds && typeof options.thresholds === 'object'
            ? options.thresholds
            : {};
        const queueLagTargetMs = Number(thresholds.maxQueueLagMs || 120000);
        const cycleDurationTargetMs = Number(thresholds.maxCycleDurationMs || 20000);
        const telemetryAgeTargetMs = Number(thresholds.maxTelemetryAgeMs || (30 * 60 * 1000));
        const p99TargetMs = Number(thresholds.p99CycleDurationMs || 10000);
        const tailWindowMinutes = Math.max(1, Number(thresholds.tailWindowMinutes || 15));
        const tailInfo = options?.tailLatency && typeof options.tailLatency === 'object'
            ? options.tailLatency
            : null;
        const tailStatus = String(tailInfo?.status || 'healthy').toUpperCase();
        const tailRunsAbove = Number(tailInfo?.runsAboveThreshold || 0);
        const tailObservedRuns = Number(tailInfo?.observedRuns || 0);
        const tailMinRuns = Math.max(1, Number(tailInfo?.minRuns || thresholds.tailMinRuns || 10));
        const tailThresholdMs = Number(tailInfo?.thresholdMs || p99TargetMs);

        const cards = [
            {
                id: 'schedulerSloErrorRate',
                value: errorRatePct,
                target: Number(thresholds.errorRatePct || 1.0),
                display: `${errorRatePct.toFixed(2)}%`,
                targetDisplay: `Target <= ${Number(thresholds.errorRatePct || 1.0).toFixed(2)}%`
            },
            {
                id: 'schedulerSloDeadLetterRate',
                value: deadLetterRatePct,
                target: Number(thresholds.deadLetterRatePct || 0.2),
                display: `${deadLetterRatePct.toFixed(2)}%`,
                targetDisplay: `Target <= ${Number(thresholds.deadLetterRatePct || 0.2).toFixed(2)}%`
            },
            {
                id: 'schedulerSloQueueLag',
                value: maxQueueLagMs,
                target: queueLagTargetMs,
                display: `${formatDurationMs(avgQueueLagMs)} avg / ${formatDurationMs(maxQueueLagMs)} max`,
                targetDisplay: `Target avg <= ${formatDurationMs(queueLagTargetMs)}, max <= ${formatDurationMs(queueLagTargetMs)}`
            },
            {
                id: 'schedulerSloCycleDuration',
                value: maxCycleDurationMs,
                target: cycleDurationTargetMs,
                display: `${formatDurationMs(avgCycleDurationMs)} avg / ${formatDurationMs(maxCycleDurationMs)} max`,
                targetDisplay: `Target avg <= ${formatDurationMs(cycleDurationTargetMs)}, max <= ${formatDurationMs(cycleDurationTargetMs)}`
            },
            {
                id: 'schedulerSloTelemetryAge',
                value: maxTelemetryAgeMs,
                target: telemetryAgeTargetMs,
                display: `${formatDurationMs(maxTelemetryAgeMs)} max`,
                targetDisplay: `Target max <= ${formatDurationMs(telemetryAgeTargetMs)}`
            },
            {
                id: 'schedulerSloCycleTailP99',
                value: p99CycleDurationMs,
                target: p99TargetMs,
                display: `${formatDurationMs(p99CycleDurationMs)} p99`,
                targetDisplay: `Target p99 <= ${formatDurationMs(p99TargetMs)} · sustained ${tailStatus} (${tailRunsAbove}/${tailObservedRuns} above ${formatDurationMs(tailThresholdMs)} in ${tailWindowMinutes}m, min ${tailMinRuns})`
            }
        ];

        cards.forEach((card) => {
            const cardEl = document.getElementById(card.id);
            if (!cardEl) return;

            const statusEl = cardEl.querySelector('.slo-status');
            const targetEl = cardEl.querySelector('.slo-value');
            const { level, label } = classifySchedulerSloLevel(card.value, card.target);
            cardEl.classList.remove('good', 'warn', 'bad');
            cardEl.classList.add(level);
            if (statusEl) {
                statusEl.textContent = `${label} - ${card.display}`;
            }
            if (targetEl && card.targetDisplay) {
                targetEl.textContent = card.targetDisplay;
            }
        });
    }

    function renderSchedulerMetricsChart(dailyRows) {
        const canvas = document.getElementById('schedulerMetricsChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const daily = Array.isArray(dailyRows) ? dailyRows : [];
        const labels = daily.map((point) => {
            const d = new Date(`${point.dayKey}T00:00:00Z`);
            return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
        });
        const cycles = daily.map((point) => Number(point.cyclesRun || 0));
        const errors = daily.map((point) => Number(point.errors || 0));
        const retries = daily.map((point) => Number(point.retries || 0));
        const avgCycleSec = daily.map((point) => {
            const ms = Number(point.avgCycleDurationMs || 0);
            return ms > 0 ? Math.round(ms / 100) / 10 : null;
        });
        const p99CycleSec = daily.map((point) => {
            const ms = Number(point.p99CycleDurationMs || 0);
            return ms > 0 ? Math.round(ms / 100) / 10 : null;
        });

        if (schedulerMetricsChart) {
            schedulerMetricsChart.destroy();
            schedulerMetricsChart = null;
        }

        schedulerMetricsChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Cycles Run',
                        data: cycles,
                        backgroundColor: 'rgba(88, 166, 255, 0.26)',
                        borderColor: 'rgba(88, 166, 255, 0.7)',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        type: 'line',
                        label: 'Errors',
                        data: errors,
                        borderColor: 'rgba(248, 113, 113, 0.95)',
                        backgroundColor: 'rgba(248, 113, 113, 0.16)',
                        borderWidth: 2,
                        pointRadius: 2,
                        tension: 0.2
                    },
                    {
                        type: 'line',
                        label: 'Retries',
                        data: retries,
                        borderColor: 'rgba(240, 136, 62, 0.95)',
                        backgroundColor: 'rgba(240, 136, 62, 0.16)',
                        borderWidth: 2,
                        pointRadius: 2,
                        tension: 0.2
                    },
                    {
                        type: 'line',
                        label: 'Avg Cycle (s)',
                        data: avgCycleSec,
                        yAxisID: 'y1',
                        borderColor: 'rgba(163, 230, 53, 0.85)',
                        backgroundColor: 'rgba(163, 230, 53, 0.12)',
                        borderWidth: 2,
                        borderDash: [4, 3],
                        pointRadius: 2,
                        tension: 0.3,
                        spanGaps: true
                    },
                    {
                        type: 'line',
                        label: 'P99 Cycle (s)',
                        data: p99CycleSec,
                        yAxisID: 'y1',
                        borderColor: 'rgba(250, 204, 21, 0.92)',
                        backgroundColor: 'rgba(250, 204, 21, 0.2)',
                        borderWidth: 2,
                        pointRadius: 2,
                        tension: 0.2,
                        spanGaps: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        labels: {
                            color: cssVar('--text-secondary'),
                            boxWidth: 12,
                            usePointStyle: true,
                            pointStyle: 'rectRounded'
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: cssVar('--text-secondary'), maxTicksLimit: 12 },
                        grid: { color: cssVar('--border-secondary') }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: cssVar('--text-secondary'), precision: 0 },
                        grid: { color: cssVar('--border-secondary') }
                    },
                    y1: {
                        beginAtZero: true,
                        position: 'right',
                        ticks: {
                            color: 'rgba(163, 230, 53, 0.7)',
                            callback: (v) => `${v}s`
                        },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    function renderSchedulerRecentRuns(recentRuns) {
        const body = document.getElementById('schedulerRecentRunsBody');
        const empty = document.getElementById('schedulerRecentRunsEmpty');
        if (!body || !empty) return;

        const runs = Array.isArray(recentRuns) ? recentRuns : [];
        if (!runs.length) {
            body.innerHTML = '';
            empty.style.display = '';
            return;
        }

        empty.style.display = 'none';
        body.innerHTML = runs.map((run) => {
            const startedAt = run.startedAtMs ? new Date(Number(run.startedAtMs)).toLocaleString('en-AU') : '-';
            const schedulerId = run.schedulerId || '-';
            const workerId = run.workerId || '-';
            const candidates = Number(run.cycleCandidates || 0);
            const cyclesRun = Number(run.cyclesRun || 0);
            const errors = Number(run.errors || 0);
            const deadLetters = Number(run.deadLetters || 0);
            const locked = Number(run.skipped?.locked || 0);
            const idempotent = Number(run.skipped?.idempotent || 0);
            const p99Cycle = formatDurationMs(run.cycleDurationMs?.p99Ms || 0);
            const maxCycle = formatDurationMs(run.cycleDurationMs?.maxMs || 0);
            const title = `run=${run.runId || '-'} worker=${workerId}`;
            return `<tr>
                <td>${startedAt}</td>
                <td title="${escapeHtml(title)}">${escapeHtml(schedulerId)}</td>
                <td>${candidates}</td>
                <td>${cyclesRun}</td>
                <td>${errors}</td>
                <td>${deadLetters}</td>
                <td>${locked}</td>
                <td>${idempotent}</td>
                <td>${p99Cycle}</td>
                <td>${maxCycle}</td>
            </tr>`;
        }).join('');
    }

    function renderSchedulerDiagnostics(diagnostics) {
        const el = document.getElementById('schedulerDiagnostics');
        if (!el) return;

        const diag = diagnostics && typeof diagnostics === 'object' ? diagnostics : {};
        const outlier = diag.outlierRun && typeof diag.outlierRun === 'object' ? diag.outlierRun : null;
        const tail = diag.tailLatency && typeof diag.tailLatency === 'object' ? diag.tailLatency : null;
        const phaseTimings = diag.phaseTimings && typeof diag.phaseTimings === 'object'
            ? diag.phaseTimings
            : null;
        const phaseRows = [
            { key: 'dataFetchMs', label: 'Fetch' },
            { key: 'ruleEvalMs', label: 'Eval' },
            { key: 'actionApplyMs', label: 'Apply' },
            { key: 'curtailmentMs', label: 'Curtail' }
        ];
        const telemetryPauseReasons = diag.telemetryPauseReasons && typeof diag.telemetryPauseReasons === 'object'
            ? diag.telemetryPauseReasons
            : {};
        const telemetryPauseReasonEntries = Object.entries(telemetryPauseReasons)
            .map(([reason, count]) => ({
                reason: String(reason || '').trim(),
                count: Number(count || 0)
            }))
            .filter((entry) => entry.reason && entry.count > 0)
            .sort((a, b) => b.count - a.count);
        const telemetryText = telemetryPauseReasonEntries.length > 0
            ? telemetryPauseReasonEntries
                .slice(0, 5)
                .map((entry) => `${entry.reason}=${entry.count}`)
                .join(', ')
            : 'none observed in window';
        const phaseComparison = phaseRows
            .map(({ key, label }) => {
                const latestMs = Number(phaseTimings?.latestRunMaxMs?.[key] || 0);
                const windowMaxMs = Number(phaseTimings?.windowMaxMs?.[key] || 0);
                return `${label} ${formatDurationMs(latestMs)} / ${formatDurationMs(windowMaxMs)}`;
            })
            .join(' | ');
        const phaseStartedAt = phaseTimings?.latestRunStartedAtMs
            ? new Date(Number(phaseTimings.latestRunStartedAtMs)).toLocaleString('en-AU')
            : '-';

        if (!outlier && !phaseTimings && telemetryPauseReasonEntries.length === 0) {
            el.textContent = 'No scheduler outlier diagnostics available yet.';
            return;
        }
        if (!outlier && phaseTimings) {
            const tailRunsAboveOnly = Number(tail?.runsAboveThreshold || 0);
            const tailObservedOnly = Number(tail?.observedRuns || 0);
            const tailMinOnly = Math.max(1, Number(tail?.minRuns || 1));
            const tailTextOnly = tail
                ? `${String(tail.status || 'healthy').toUpperCase()} (${tailRunsAboveOnly}/${tailObservedOnly} runs above ${formatDurationMs(tail.thresholdMs || 0)} in ${Math.max(1, Number(tail.windowMinutes || 15))}m window; min ${tailMinOnly})`
                : 'No sustained tail data';
            el.innerHTML = `
                <div><strong>Phase Timings:</strong> latest run @ ${escapeHtml(phaseStartedAt)} maxes (latest / window): ${escapeHtml(phaseComparison)}</div>
                <div><strong>Sustained Tail Signal:</strong> ${escapeHtml(tailTextOnly)}</div>
                <div><strong>Telemetry Fail-safe Reasons:</strong> ${escapeHtml(telemetryText)}</div>
            `;
            return;
        }
        if (!outlier) {
            el.innerHTML = `
                <div><strong>Telemetry Fail-safe Reasons:</strong> ${escapeHtml(telemetryText)}</div>
            `;
            return;
        }

        const startedAt = outlier?.startedAtMs ? new Date(Number(outlier.startedAtMs)).toLocaleString('en-AU') : '-';
        const slowest = outlier?.slowestCycle && typeof outlier.slowestCycle === 'object' ? outlier.slowestCycle : null;
        const causes = Array.isArray(outlier?.likelyCauses) ? outlier.likelyCauses : [];
        const causeText = causes.length ? causes.join(', ') : 'no_clear_cause_from_scheduler_metrics';
        const tailRunsAbove = Number(tail?.runsAboveThreshold || 0);
        const tailObservedRuns = Number(tail?.observedRuns || 0);
        const tailMinRuns = Math.max(1, Number(tail?.minRuns || 1));
        const tailText = tail
            ? `${String(tail.status || 'healthy').toUpperCase()} (${tailRunsAbove}/${tailObservedRuns} runs above ${formatDurationMs(tail.thresholdMs || 0)} in ${Math.max(1, Number(tail.windowMinutes || 15))}m window; min ${tailMinRuns})`
            : 'No sustained tail data';

        const slowestText = slowest
            ? `slowestCycle user=${escapeHtml(slowest.userId || '-')} duration=${formatDurationMs(slowest.durationMs || 0)} queue=${formatDurationMs(slowest.queueLagMs || 0)} retries=${Number(slowest.retriesUsed || 0)} failure=${escapeHtml(slowest.failureType || 'none')}`
            : 'slowestCycle unavailable';

        el.innerHTML = `
            <div><strong>Outlier Run:</strong> ${escapeHtml(outlier?.runId || '-')} @ ${escapeHtml(startedAt)} (scheduler=${escapeHtml(outlier?.schedulerId || '-')}, worker=${escapeHtml(outlier?.workerId || '-')})</div>
            <div><strong>Tail:</strong> p95=${formatDurationMs(outlier?.p95CycleDurationMs || 0)}, p99=${formatDurationMs(outlier?.p99CycleDurationMs || 0)}, max=${formatDurationMs(outlier?.maxCycleDurationMs || 0)}, queueMax=${formatDurationMs(outlier?.queueLagMaxMs || 0)}</div>
            <div><strong>Phase Timings:</strong> latest run @ ${escapeHtml(phaseStartedAt)} maxes (latest / window): ${escapeHtml(phaseComparison)}</div>
            <div><strong>Likely Causes:</strong> ${escapeHtml(causeText)}</div>
            <div><strong>Slowest Cycle:</strong> ${slowestText}</div>
            <div><strong>Sustained Tail Signal:</strong> ${escapeHtml(tailText)}</div>
            <div><strong>Telemetry Fail-safe Reasons:</strong> ${escapeHtml(telemetryText)}</div>
        `;
    }

    function formatSchedulerAlertMessage(currentAlert) {
        const alert = currentAlert && typeof currentAlert === 'object' ? currentAlert : null;
        if (!alert) return '';
        const status = String(alert.status || '').toLowerCase();
        const severity = status === 'breach' ? 'BREACH' : 'WATCH';
        const breached = Array.isArray(alert.breachedMetrics) ? alert.breachedMetrics : [];
        const watched = Array.isArray(alert.watchMetrics) ? alert.watchMetrics : [];
        const metricList = status === 'breach' ? breached : watched;
        const metricHint = metricList.length ? ` [${metricList.join(', ')}]` : '';
        return `Scheduler SLO ${severity}${metricHint}. See SLO cards and diagnostics for details.`;
    }

    async function loadSchedulerMetrics() {
        const updatedEl = document.getElementById('schedulerMetricsUpdated');
        const warningEl = document.getElementById('schedulerMetricsWarning');
        const refreshBtn = document.getElementById('refreshSchedulerBtn');
        if (!adminApiClient || !updatedEl || !warningEl) return;

        if (refreshBtn) refreshBtn.disabled = true;
        updatedEl.textContent = 'Loading scheduler metrics...';
        warningEl.style.display = 'none';
        warningEl.textContent = '';

        try {
            const days = 14;
            const includeRuns = true;
            const runLimit = 30;
            let data;
            if (typeof adminApiClient.getAdminSchedulerMetrics === 'function') {
                data = await adminApiClient.getAdminSchedulerMetrics(days, includeRuns, runLimit);
            } else {
                const query = new URLSearchParams({
                    days: String(days),
                    includeRuns: includeRuns ? '1' : '0',
                    runLimit: String(runLimit)
                });
                const resp = await adminApiClient.fetch(`/api/admin/scheduler-metrics?${query.toString()}`);
                if (!resp.ok) throw new Error(`Request failed: ${resp.status}`);
                const rawBody = await resp.text();
                let parsed = null;
                if (rawBody) {
                    try {
                        parsed = JSON.parse(rawBody);
                    } catch (parseError) {
                        throw new Error('Invalid scheduler metrics response');
                    }
                }
                if (!parsed || typeof parsed !== 'object') throw new Error('Invalid scheduler metrics response');
                data = parsed;
            }
            if (!data || data.errno !== 0) throw new Error(data?.error || 'Failed to load scheduler metrics');

            const result = data.result || {};
            const summary = result.summary || {};
            const daily = Array.isArray(result.daily) ? result.daily : [];
            const recentRuns = Array.isArray(result.recentRuns) ? result.recentRuns : [];
            const queueLagAverage = computeWeightedRunAverageMs(recentRuns, 'queueLagMs');
            const cycleDurationAverage = computeWeightedRunAverageMs(recentRuns, 'cycleDurationMs');
            const currentAlert = result.currentAlert && typeof result.currentAlert === 'object'
                ? result.currentAlert
                : null;
            const diagnostics = result.diagnostics && typeof result.diagnostics === 'object'
                ? result.diagnostics
                : {};
            const tailLatency = diagnostics.tailLatency && typeof diagnostics.tailLatency === 'object'
                ? diagnostics.tailLatency
                : (currentAlert?.tailLatency && typeof currentAlert.tailLatency === 'object'
                    ? currentAlert.tailLatency
                    : null);
            const sloThresholds = currentAlert?.thresholds && typeof currentAlert.thresholds === 'object'
                ? currentAlert.thresholds
                : {};

            document.getElementById('schedulerRuns').textContent = formatCompactNumber(summary.runs || 0);
            document.getElementById('schedulerCyclesRun').textContent = formatCompactNumber(summary.cyclesRun || 0);
            document.getElementById('schedulerErrors').textContent = formatCompactNumber(summary.errors || 0);
            document.getElementById('schedulerErrorRate').textContent = `${Number(summary.errorRatePct || 0).toFixed(2)}%`;
            document.getElementById('schedulerRetriesDeadLetters').textContent =
                `${formatCompactNumber(summary.retries || 0)} / ${formatCompactNumber(summary.deadLetters || 0)}`;
            document.getElementById('schedulerLockIdempotentSkips').textContent =
                `${formatCompactNumber(summary.skipped?.locked || 0)} / ${formatCompactNumber(summary.skipped?.idempotent || 0)}`;
            const p95El = document.getElementById('schedulerTailP95');
            const p99El = document.getElementById('schedulerTailP99');
            if (p95El) p95El.textContent = formatDurationMs(summary.p95CycleDurationMs || 0);
            if (p99El) p99El.textContent = formatDurationMs(summary.p99CycleDurationMs || 0);
            renderSchedulerSloCards(summary, {
                avgQueueLagMs: queueLagAverage.avgMs,
                avgCycleDurationMs: cycleDurationAverage.avgMs,
                thresholds: sloThresholds,
                tailLatency
            });

            renderSchedulerMetricsChart(daily);
            renderSchedulerRecentRuns(recentRuns.slice(0, 20));
            renderSchedulerDiagnostics({
                outlierRun: diagnostics.outlierRun || null,
                tailLatency,
                phaseTimings: diagnostics.phaseTimings || null,
                telemetryPauseReasons: diagnostics.telemetryPauseReasons || summary.telemetryPauseReasons || {}
            });

            const updatedAt = result.updatedAt ? new Date(result.updatedAt) : new Date();
            updatedEl.textContent = `Last updated ${updatedAt.toLocaleDateString('en-AU')} ${updatedAt.toLocaleTimeString('en-AU')} · window has ${daily.length} day(s) with data`;

            if (currentAlert && String(currentAlert.status || '').toLowerCase() === 'breach') {
                warningEl.style.display = '';
                warningEl.textContent = formatSchedulerAlertMessage(currentAlert);
            }
        } catch (e) {
            updatedEl.textContent = 'Unable to load scheduler metrics';
            warningEl.style.display = '';
            warningEl.textContent = e.message || String(e);
            renderSchedulerSloCards(null);
            renderSchedulerRecentRuns([]);
            renderSchedulerDiagnostics(null);
            const p95El = document.getElementById('schedulerTailP95');
            const p99El = document.getElementById('schedulerTailP99');
            if (p95El) p95El.textContent = '-';
            if (p99El) p99El.textContent = '-';
            showMessage('warning', `Failed to load scheduler metrics: ${e.message || e}`);
        } finally {
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }

    // ==================== Platform Stats ====================
    function updatePlatformStats(users) {
        // Keep KPIs responsive even if trend endpoint temporarily fails.
        document.getElementById('statTotalUsers').textContent = users.length;
        // MAU: users with lastSignedInAt in the current calendar month
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const mau = users.filter(u => {
            const ts = u.lastSignedInAt;
            if (!ts) return false;
            const ms = typeof ts === 'number' ? ts
                : ts._seconds ? ts._seconds * 1000
                : ts.seconds ? ts.seconds * 1000
                : Date.parse(ts);
            return Number.isFinite(ms) && ms >= monthStart;
        }).length;
        document.getElementById('statMAU').textContent = mau;
        document.getElementById('statAutomationActive').textContent = users.filter(u => u.automationEnabled).length;
        document.getElementById('statConfigured').textContent = users.filter(isUserConfigured).length;
    }

    // ==================== Role Management ====================
    async function setRole(uid, role) {
        const action = role === 'admin' ? 'promote' : 'demote';
        const user = currentUsers.find(u => u.uid === uid);
        const label = user?.email || uid;
        if (!confirm(`Are you sure you want to ${action} "${label}" to ${role}?`)) return;

        try {
            const resp = await adminApiClient.fetch(`/api/admin/users/${uid}/role`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role })
            });
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Failed to update role');
            showMessage('success', `✅ ${label} is now ${role}`);
            loadUsers();
        } catch (e) {
            showMessage('error', `❌ Failed to update role: ${e.message}`);
        }
    }

    // ==================== Impersonation ====================
    function setImpersonationState(uid, email, mode) {
        try {
            localStorage.setItem('adminImpersonationUid', uid);
            localStorage.setItem('adminImpersonationEmail', email || '');
            localStorage.setItem('adminImpersonationMode', mode || 'customToken');
            localStorage.setItem('adminImpersonationStartedAt', String(Date.now()));
        } catch (e) {
            console.warn('[Admin] Failed to store impersonation state:', e);
        }
    }

    async function impersonateUser(uid, email) {
        if (!confirm(`You are about to sign in as "${email}". You will be redirected to the dashboard as that user.\n\nTo return to admin, sign out and sign back in with your admin credentials.\n\nContinue?`)) return;

        try {
            const resp = await adminApiClient.fetch('/api/admin/impersonate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid })
            });
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Impersonation failed');

            const mode = data.result?.mode || 'customToken';
            const targetEmail = data.result?.targetEmail || email || uid;

            if (mode !== 'customToken' || !data.result?.customToken) {
                throw new Error('Impersonation requires IAM token-signing (custom token mode only).');
            }

            showMessage('info', `🔄 Signing in as ${targetEmail}...`, 0);
            setImpersonationState(uid, targetEmail, 'customToken');
            await firebase.auth().signInWithCustomToken(data.result.customToken);
            window.location.href = '/app.html';
        } catch (e) {
            try {
                localStorage.removeItem('adminImpersonationUid');
                localStorage.removeItem('adminImpersonationEmail');
                localStorage.removeItem('adminImpersonationMode');
                localStorage.removeItem('adminImpersonationStartedAt');
            } catch (storageErr) {
                console.warn('[Admin] Failed to clear impersonation state after error:', storageErr);
            }
            showMessage('error', `❌ Impersonation failed: ${e.message}`);
        }
    }

    // ==================== User Stats Drawer ====================
    function openStatsDrawer() {
        document.getElementById('statsDrawer').classList.add('open');
        document.getElementById('statsBackdrop').classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeStatsDrawer() {
        document.getElementById('statsDrawer').classList.remove('open');
        document.getElementById('statsBackdrop').classList.remove('open');
        document.body.style.overflow = '';
    }

    document.getElementById('statsBackdrop').addEventListener('click', closeStatsDrawer);

    async function viewStats(uid, email) {
        document.getElementById('statsDrawerTitle').textContent = `Stats: ${email || uid}`;
        document.getElementById('statsDrawerBody').innerHTML = '<div class="loading-spinner">Loading stats...</div>';
        openStatsDrawer();

        try {
            const resp = await adminApiClient.fetch(`/api/admin/users/${uid}/stats`);
            const data = await resp.json();
            if (data.errno !== 0) throw new Error(data.error || 'Failed to load stats');

            renderStats(data.result);
        } catch (e) {
            document.getElementById('statsDrawerBody').innerHTML = `<p style="color: var(--color-danger); padding: 20px;">Failed to load stats: ${e.message}</p>`;
        }
    }

    const PROVIDER_LABELS = {
        foxess: 'FoxESS',
        sungrow: 'Sungrow',
        sigenergy: 'SigenEnergy',
        alphaess: 'AlphaESS'
    };

    function normalizeProvider(providerRaw, cfg = null) {
        const provider = String(providerRaw || '').toLowerCase().trim();
        if (provider) return provider;
        if (cfg && typeof cfg === 'object') {
            if (cfg.hasSungrowUsername || cfg.hasSungrowDeviceSn) return 'sungrow';
            if (cfg.hasSigenUsername || cfg.hasSigenStationId || cfg.hasSigenDeviceSn) return 'sigenergy';
            if (cfg.hasAlphaEssSystemSn || cfg.hasAlphaEssAppId || cfg.hasAlphaEssAppSecret) return 'alphaess';
        }
        return 'foxess';
    }

    function providerLabel(providerRaw) {
        const rawProvider = String(providerRaw || '').toLowerCase().trim();
        if (!rawProvider) return 'Unknown';
        const provider = normalizeProvider(rawProvider);
        if (PROVIDER_LABELS[provider]) return PROVIDER_LABELS[provider];
        return provider ? `${provider.charAt(0).toUpperCase()}${provider.slice(1)}` : 'Unknown';
    }

    function toCounter(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function getProviderAccessSummary(cfg = {}, provider = 'foxess') {
        const providedSummary = cfg.providerAccess;
        if (providedSummary && typeof providedSummary === 'object') {
            return {
                identifierLabel: providedSummary.identifierLabel || 'Device ID',
                hasIdentifier: !!providedSummary.hasIdentifier,
                credentialLabel: providedSummary.credentialLabel || 'Credentials',
                hasCredential: !!providedSummary.hasCredential
            };
        }

        switch (provider) {
            case 'sungrow':
                return {
                    identifierLabel: 'Device SN',
                    hasIdentifier: !!cfg.hasSungrowDeviceSn,
                    credentialLabel: 'iSolarCloud Login',
                    hasCredential: !!cfg.hasSungrowUsername
                };
            case 'sigenergy':
                return {
                    identifierLabel: 'Station / Device ID',
                    hasIdentifier: !!(cfg.hasSigenStationId || cfg.hasSigenDeviceSn),
                    credentialLabel: 'Account Login',
                    hasCredential: !!cfg.hasSigenUsername
                };
            case 'alphaess':
                return {
                    identifierLabel: 'System SN',
                    hasIdentifier: !!cfg.hasAlphaEssSystemSn,
                    credentialLabel: 'App Credentials',
                    hasCredential: !!(cfg.hasAlphaEssAppId && cfg.hasAlphaEssAppSecret)
                };
            case 'foxess':
            default:
                return {
                    identifierLabel: 'Device SN',
                    hasIdentifier: !!cfg.hasDeviceSn,
                    credentialLabel: 'API Token',
                    hasCredential: !!cfg.hasFoxessToken
                };
        }
    }

    function summarizeInverterUsage(dayMetrics = {}) {
        const byProvider = {};
        const providerSource = (dayMetrics.inverterByProvider && typeof dayMetrics.inverterByProvider === 'object')
            ? dayMetrics.inverterByProvider
            : {};

        Object.entries(providerSource).forEach(([providerKey, value]) => {
            const count = toCounter(value);
            if (!count) return;
            byProvider[normalizeProvider(providerKey)] = count;
        });

        ['foxess', 'sungrow', 'sigenergy', 'alphaess'].forEach((providerKey) => {
            if (Object.prototype.hasOwnProperty.call(byProvider, providerKey)) return;
            const count = toCounter(dayMetrics[providerKey]);
            if (!count) return;
            byProvider[providerKey] = count;
        });

        let inverter = toCounter(dayMetrics.inverter);
        if (!inverter) {
            inverter = Object.values(byProvider).reduce((sum, count) => sum + count, 0);
            Object.entries(dayMetrics).forEach(([metricKey, metricValue]) => {
                if (metricKey === 'inverter' || metricKey === 'inverterByProvider' || metricKey === 'amber' || metricKey === 'weather' || metricKey === 'updatedAt') return;
                if (Object.prototype.hasOwnProperty.call(byProvider, normalizeProvider(metricKey))) return;
                inverter += toCounter(metricValue);
            });
        }

        const breakdown = Object.entries(byProvider)
            .sort((a, b) => b[1] - a[1])
            .map(([providerKey, count]) => `${providerLabel(providerKey)}: ${count}`)
            .join(', ');

        return { inverter, breakdown };
    }

    function renderStats(stats) {
        const body = document.getElementById('statsDrawerBody');
        const cfg = stats.configSummary || {};
        const autoState = stats.automationState || {};
        const provider = normalizeProvider(cfg.deviceProvider, cfg);
        const providerName = providerLabel(provider);
        const providerAccess = getProviderAccessSummary(cfg, provider);
        const inverterCapacityW = Number(cfg.inverterCapacityW);
        const batteryCapacityKWh = Number(cfg.batteryCapacityKWh);
        const inverterLabel = Number.isFinite(inverterCapacityW) && inverterCapacityW > 0
            ? `${(inverterCapacityW / 1000).toFixed(1)} kW`
            : 'Not set';
        const batteryLabel = Number.isFinite(batteryCapacityKWh) && batteryCapacityKWh > 0
            ? `${batteryCapacityKWh.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kWh`
            : 'Not set';
        const locationLabel = (typeof cfg.location === 'string' && cfg.location.trim())
            ? cfg.location.trim()
            : 'Not set';
        const tourStatusLabel = cfg.tourComplete ? '✅ Watched' : '❌ Not watched';

        const topologyCouplingRaw = (cfg.systemTopology && cfg.systemTopology.coupling)
            ? String(cfg.systemTopology.coupling).toLowerCase()
            : 'unknown';
        const topologyCouplingLabel = topologyCouplingRaw === 'ac'
            ? 'AC-Coupled'
            : (topologyCouplingRaw === 'dc' ? 'DC-Coupled' : 'Not set');

        // Config summary section
        let configHtml = `
            <div class="stat-section">
                <div class="stat-section-title">Configuration</div>
                <div class="stat-subsection">
                    <div class="stat-subsection-title">Access & Integrations</div>
                    <div class="stat-grid">
                        <div class="stat-item">
                            <div class="label">Inverter Provider</div>
                            <div class="value small">${providerName}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">${providerAccess.identifierLabel}</div>
                            <div class="value small">${providerAccess.hasIdentifier ? '✅ Configured' : '❌ Missing'}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">${providerAccess.credentialLabel}</div>
                            <div class="value small">${providerAccess.hasCredential ? '✅ Set' : '❌ Missing'}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">Amber API Key</div>
                            <div class="value small">${cfg.hasAmberApiKey ? '✅ Set' : '❌ Missing'}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">Rules</div>
                            <div class="value">${stats.ruleCount}</div>
                        </div>
                    </div>
                </div>

                <div class="stat-subsection">
                    <div class="stat-subsection-title">System Context</div>
                    <div class="stat-grid">
                        <div class="stat-item">
                            <div class="label">Location</div>
                            <div class="value small">${locationLabel}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">Tour</div>
                            <div class="value small">${tourStatusLabel}</div>
                        </div>
                    </div>
                </div>

                <div class="stat-subsection">
                    <div class="stat-subsection-title">Sizing & Topology</div>
                    <div class="stat-grid">
                        <div class="stat-item">
                            <div class="label">Inverter Size</div>
                            <div class="value small">${inverterLabel}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">Battery Size</div>
                            <div class="value small">${batteryLabel}</div>
                        </div>
                        <div class="stat-item">
                            <div class="label">System Topology</div>
                            <div class="value small">${topologyCouplingLabel}</div>
                        </div>
                    </div>
                </div>
            </div>`;

        // Automation state section
        let automationHtml = `
            <div class="stat-section">
                <div class="stat-section-title">Automation</div>
                <div class="stat-grid">
                    <div class="stat-item">
                        <div class="label">Status</div>
                        <div class="value small">${autoState.enabled ? '<span class="status-dot active"></span>Enabled' : '<span class="status-dot inactive"></span>Disabled'}</div>
                    </div>
                    <div class="stat-item">
                        <div class="label">Active Rule</div>
                        <div class="value small">${autoState.activeRule || 'None'}</div>
                    </div>
                </div>
            </div>`;

        // API usage metrics section
        const metrics = stats.metrics || {};
        const days = Object.keys(metrics).sort().reverse().slice(0, 14); // Last 14 days
        let maxTotal = 1;
        days.forEach(day => {
            const m = metrics[day] || {};
            const inverterUsage = summarizeInverterUsage(m);
            const total = inverterUsage.inverter + toCounter(m.amber) + toCounter(m.weather);
            if (total > maxTotal) maxTotal = total;
        });

        let metricsHtml = '<div class="stat-section"><div class="stat-section-title">API Usage (Last 14 Days)</div>';
        if (days.length === 0) {
            metricsHtml += '<p style="color: var(--text-secondary); font-size: 13px;">No metrics data available</p>';
        } else {
            metricsHtml += `<div class="metrics-legend">
                <span class="inverter">Inverter</span>
                <span class="amber">Amber</span>
                <span class="weather">Weather</span>
            </div>`;
            days.forEach(day => {
                const m = metrics[day] || {};
                const inverterUsage = summarizeInverterUsage(m);
                const inverter = inverterUsage.inverter;
                const amber = toCounter(m.amber);
                const weather = toCounter(m.weather);
                const total = inverter + amber + weather;
                const barScale = 200; // max bar width in px
                const inverterTitle = inverterUsage.breakdown
                    ? `Inverter: ${inverter} (${inverterUsage.breakdown})`
                    : `Inverter: ${inverter}`;
                metricsHtml += `<div class="metrics-day">
                    <span class="date">${day.slice(5)}</span>
                    <div class="metrics-bar-group">
                        <div class="metrics-bar inverter" style="width: ${Math.max(2, inverter / maxTotal * barScale)}px;" title="${inverterTitle}"></div>
                        <div class="metrics-bar amber" style="width: ${Math.max(2, amber / maxTotal * barScale)}px;" title="Amber: ${amber}"></div>
                        <div class="metrics-bar weather" style="width: ${Math.max(2, weather / maxTotal * barScale)}px;" title="Weather: ${weather}"></div>
                    </div>
                    <span class="total">${total}</span>
                </div>`;
            });
        }
        metricsHtml += '</div>';

        body.innerHTML = configHtml + automationHtml + metricsHtml;
    }

    // ==================== Init ====================
    AppShell.init({ pageName: 'admin', requireAuth: true, checkSetup: false });
    AppShell.onReady(async (ctx) => {
        adminApiClient = ctx.apiClient;
        if (!adminApiClient) {
            document.getElementById('accessDenied').style.display = '';
            return;
        }
        await checkAdminAccess();
    });
    
