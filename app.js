const SUPABASE_URL = 'https://pdauvrbwudggldekvgqk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_u0jFS226U6u3lz2oGUabew_d4FfXh-x';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

class AccountsApp {
    constructor() {
        this.supabase = _supabase;
        this.user = null;
        this.isSignUp = false;
        this.clients = [];
        this.transactions = [];
        this.currentViewId = 'dashboard-view';
        this.currentClientId = null;
        this.exchangeRate = parseFloat(localStorage.getItem('ar_exchange_rate')) || 1;
        this.rateHistory = JSON.parse(localStorage.getItem('ar_rate_history')) || [];
        this.paymentsChart = null;

        this.init();
    }

    async init() {
        document.getElementById('exchangeRateInput').value = this.exchangeRate.toFixed(2);
        this.bindEvents();
        this.bindAuthEvents();

        // Check for existing session
        const { data: { session } } = await this.supabase.auth.getSession();
        if (session) {
            this.handleAuthStateChange(session.user);
        }

        this.fetchBCVRate(); // Sync on load
    }

    bindEvents() {
        // Main Navigation
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetId = e.currentTarget.dataset.target;
                if (targetId) this.switchView(targetId);
            });
        });

        // Search
        document.getElementById('globalSearchInput').addEventListener('input', (e) => {
            this.renderClientsTable(e.target.value);
        });

        // Logout
        document.getElementById('logoutBtn').addEventListener('click', () => this.handleLogout());

        // Exchange Rate
        document.getElementById('exchangeRateInput').addEventListener('change', (e) => {
            const val = parseFloat(e.target.value);
            if (val > 0) {
                this.updateExchangeRate(val);
                this.showToast('Tasa de cambio actualizada');
            }
        });

        document.getElementById('syncRateBtn').addEventListener('click', () => {
            this.fetchBCVRate();
        });

        // Converter logic
        const convUSD = document.getElementById('convUSD');
        const convVEF = document.getElementById('convVEF');

        convUSD.addEventListener('input', (e) => {
            const usd = parseFloat(e.target.value);
            if (!isNaN(usd)) {
                convVEF.value = (usd * this.exchangeRate).toFixed(2);
            } else {
                convVEF.value = '';
            }
        });

        convVEF.addEventListener('input', (e) => {
            const vef = parseFloat(e.target.value);
            if (!isNaN(vef)) {
                convUSD.value = (vef / this.exchangeRate).toFixed(2);
            } else {
                convUSD.value = '';
            }
        });

        // Client Form
        document.getElementById('clientForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleClientSubmit();
        });

        // Chart Range
        document.getElementById('chartTimeRange').addEventListener('change', () => {
            this.renderDailyChart();
        });

        // Transaction Modal
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', () => this.closeTransactionModal());
        });

        document.getElementById('transactionForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleTransactionSubmit();
        });
    }

    bindAuthEvents() {
        const loginForm = document.getElementById('loginForm');
        const toggleBtn = document.getElementById('toggleAuthBtn');

        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAuthSubmit();
        });

        toggleBtn.addEventListener('click', () => this.toggleAuthMode());
    }

    // --- Auth Logic ---

    toggleAuthMode() {
        this.isSignUp = !this.isSignUp;
        const title = document.querySelector('.auth-header h2');
        const subtitle = document.getElementById('auth-subtitle');
        const btn = document.getElementById('loginBtn');
        const toggle = document.getElementById('toggleAuthBtn');

        if (this.isSignUp) {
            title.textContent = 'Crear Cuenta';
            subtitle.textContent = 'Regístrate para comenzar a gestionar tus cuentas';
            btn.textContent = 'Registrarse';
            toggle.textContent = '¿Ya tienes cuenta? Inicia sesión';
        } else {
            title.textContent = 'Inversiones Morey';
            subtitle.textContent = 'Inicia sesión para gestionar tus cobranzas';
            btn.textContent = 'Entrar';
            toggle.textContent = '¿No tienes cuenta? Regístrate';
        }
    }

    async handleAuthSubmit() {
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const btn = document.getElementById('loginBtn');

        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-circle-notch animate-spin"></i> Cargando...';

        try {
            if (this.isSignUp) {
                const { data, error } = await this.supabase.auth.signUp({ email, password });
                if (error) throw error;
                this.showToast('Cuenta creada. Por favor verifica tu correo.', 'info');
            } else {
                const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                this.handleAuthStateChange(data.user);
            }
        } catch (error) {
            this.showToast(error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = this.isSignUp ? 'Registrarse' : 'Entrar';
        }
    }

    handleAuthStateChange(user) {
        this.user = user;
        if (user) {
            document.getElementById('auth-overlay').classList.add('hidden');
            document.getElementById('main-app').classList.remove('hidden');
            this.saveData(); // Triggers sync
        } else {
            document.getElementById('auth-overlay').classList.remove('hidden');
            document.getElementById('main-app').classList.add('hidden');
        }
    }

    async handleLogout() {
        await this.supabase.auth.signOut();
        this.handleAuthStateChange(null);
        this.showToast('Sesión cerrada');
    }

    // --- State & Storage (Supabase) ---

    async syncWithSupabase() {
        if (!this.user) return;

        // First check if migration is needed
        const localClients = JSON.parse(localStorage.getItem('ar_clients')) || [];
        const localTransactions = JSON.parse(localStorage.getItem('ar_transactions')) || [];

        if (localClients.length > 0) {
            console.log("Migrating local data to Supabase...");
            await this.migrateLocalToSupabase(localClients, localTransactions);
            localStorage.removeItem('ar_clients');
            localStorage.removeItem('ar_transactions');
            this.showToast('Datos localizados migrados a la nube');
        }

        const { data: clients, error: cErr } = await this.supabase
            .from('clients')
            .select('*')
            .eq('user_id', this.user.id);

        const { data: transactions, error: tErr } = await this.supabase
            .from('transactions')
            .select('*')
            .eq('user_id', this.user.id);

        if (!cErr) this.clients = clients.map(c => ({
            ...c,
            id: c.local_id || c.id
        }));

        if (!tErr) this.transactions = transactions.map(t => ({
            ...t,
            id: t.local_id || t.id
        }));
    }

    async migrateLocalToSupabase(clients, transactions) {
        if (!this.user) return;

        for (const c of clients) {
            const { data: newC } = await this.supabase.from('clients').upsert({
                name: c.name,
                category: c.category,
                phone: c.phone,
                email: c.email,
                address: c.address,
                created_at: new Date(c.createdAt).toISOString(),
                local_id: c.id,
                user_id: this.user.id
            }).select().single();

            if (newC) {
                const clientTxs = transactions.filter(t => t.clientId === c.id);
                for (const t of clientTxs) {
                    await this.supabase.from('transactions').insert({
                        client_id: newC.id,
                        type: t.type,
                        amount: t.amount,
                        description: t.description,
                        created_at: new Date(t.createdAt).toISOString(),
                        local_id: t.id,
                        user_id: this.user.id
                    });
                }
            }
        }
    }

    async saveData() {
        // In this version, saveData is for updating the UI after remote sync
        await this.syncWithSupabase();
        this.renderDashboard();
        if (this.currentClientId && this.currentViewId === 'client-profile-view') {
            this.renderClientProfile(this.currentClientId);
        }
    }

    getUniqueId() {
        return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    }

    getClient(id) {
        return this.clients.find(c => c.id === id);
    }

    getClientBalance(clientId) {
        const txs = this.transactions.filter(t => t.clientId === clientId);
        return txs.reduce((acc, tx) => {
            if (tx.type === 'SALE') return acc + tx.amount;
            if (tx.type === 'PAYMENT') return acc - tx.amount;
            return acc;
        }, 0);
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    }

    formatVEF(amount) {
        const vefAmount = amount * this.exchangeRate;
        return 'Bs. ' + new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(vefAmount);
    }

    formatDate(timestamp) {
        return new Intl.DateTimeFormat('es-DO', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        }).format(new Date(timestamp));
    }

    getInitials(name) {
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    }

    async fetchBCVRate() {
        const btn = document.getElementById('syncRateBtn');
        const input = document.getElementById('exchangeRateInput');

        btn.classList.add('loading');

        try {
            // Using a community mirror of BCV to avoid CORS issues
            const response = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
            const data = await response.json();

            if (data && data.promedio) {
                const rate = data.promedio;
                this.updateExchangeRate(rate);
                this.showToast(`Sincronizado con BCV: ${rate.toFixed(2)} Bs.`);
            }
        } catch (error) {
            console.error('Error fetching BCV rate:', error);
            this.showToast('No se pudo conectar con el BCV', 'error');
        } finally {
            btn.classList.remove('loading');
        }
    }

    exportData() {
        const data = {
            clients: this.clients,
            transactions: this.transactions,
            exchangeRate: this.exchangeRate,
            exportDate: new Date().toISOString()
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `cobranzas_backup_${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        this.showToast('Datos exportados exitosamente');
    }

    importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.clients && data.transactions) {
                    this.clients = data.clients;
                    this.transactions = data.transactions;
                    this.exchangeRate = data.exchangeRate || this.exchangeRate;

                    this.saveData();
                    this.renderDashboard();
                    this.showToast('Datos importados correctamente');

                    // Reset file input
                    event.target.value = '';
                } else {
                    this.showToast('El archivo no tiene el formato correcto', 'error');
                }
            } catch (err) {
                this.showToast('Error al leer el archivo', 'error');
            }
        };
        reader.readAsText(file);
    }

    resetConverter() {
        document.getElementById('convUSD').value = '';
        document.getElementById('convVEF').value = '';
    }

    updateExchangeRate(rate) {
        this.exchangeRate = rate;
        document.getElementById('exchangeRateInput').value = rate.toFixed(2);
        localStorage.setItem('ar_exchange_rate', rate);

        // Update history for the sparkline (max 10 points)
        const today = new Date().toISOString().split('T')[0];
        const lastEntry = this.rateHistory[this.rateHistory.length - 1];

        if (!lastEntry || lastEntry.date !== today) {
            this.rateHistory.push({ date: today, rate: rate });
        } else {
            lastEntry.rate = rate; // Update today's rate if multiple syncs
        }

        if (this.rateHistory.length > 10) this.rateHistory.shift();
        localStorage.setItem('ar_rate_history', JSON.stringify(this.rateHistory));

        this.renderDashboard();
        this.renderSparkline();

        if (this.currentClientId && this.currentViewId === 'client-profile-view') {
            this.renderClientProfile(this.currentClientId);
        }
    }

    renderSparkline() {
        const svg = document.getElementById('rateSparkline');
        const path = svg.querySelector('path');

        // If no history, create some dummy data based on current for visual effect
        let data = this.rateHistory.map(h => h.rate);
        if (data.length < 5) {
            // Simulated history for first time users
            const base = this.exchangeRate;
            data = [base * 0.98, base * 1.01, base * 0.99, base * 1.02, base];
        } else {
            data = data.slice(-5);
        }

        const min = Math.min(...data) * 0.999;
        const max = Math.max(...data) * 1.001;
        const range = max - min;

        const width = 100;
        const height = 30;
        const step = width / (data.length - 1);

        let d = `M 0 ${height - ((data[0] - min) / range * height)}`;

        for (let i = 1; i < data.length; i++) {
            const x = i * step;
            const y = height - ((data[i] - min) / range * height);
            d += ` L ${x} ${y}`;
        }

        path.setAttribute('d', d);

        // Update trend icon
        const icon = document.getElementById('rateTrendIcon');
        if (data.length >= 2) {
            const isUp = data[data.length - 1] >= data[data.length - 2];
            icon.className = isUp ? 'ph ph-trend-up' : 'ph ph-trend-down';
            icon.style.color = isUp ? 'var(--accent-green)' : 'var(--accent-red)';
            path.style.stroke = isUp ? 'var(--accent-green)' : 'var(--accent-red)';
        }
    }

    // --- Navigation & Views ---

    switchView(viewId) {
        // Update Nav Active State
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
        const navBtn = document.querySelector(`.nav-item[data-target="${viewId}"]`);
        if (navBtn) navBtn.classList.add('active');

        // Toggle Sections
        document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
        const targetSection = document.getElementById(viewId);
        if (targetSection) {
            targetSection.classList.add('active');
            this.currentViewId = viewId;
        }

        // Specific actions on open
        if (viewId === 'dashboard-view') {
            this.renderDashboard();
        } else if (viewId === 'clients-view') {
            document.getElementById('globalSearchInput').value = '';
            this.renderClientsTable('');
        } else if (viewId === 'add-client-view') {
            this.resetClientForm();
        } else if (viewId === 'converter-view') {
            document.getElementById('converterRateDisplay').textContent = `Tasa actual: 1$ = ${this.exchangeRate.toFixed(2)} Bs.`;
        }
    }

    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        const icon = toast.querySelector('i');
        const msgSpan = document.getElementById('toastMessage');

        msgSpan.textContent = message;
        if (type === 'success') {
            icon.className = 'ph ph-check-circle toast-icon text-success';
        } else {
            icon.className = 'ph ph-warning-circle toast-icon text-danger';
        }

        toast.classList.add('active');
        setTimeout(() => toast.classList.remove('active'), 3000);
    }

    // --- Dashboard logic ---

    renderDashboard() {
        // Summaries
        const totalClients = this.clients.length;
        let totalSystemDebt = 0;

        this.clients.forEach(c => {
            totalSystemDebt += this.getClientBalance(c.id);
        });

        document.getElementById('totalClientsCount').textContent = totalClients;
        document.getElementById('totalDebtAmount').textContent = this.formatCurrency(totalSystemDebt);
        document.getElementById('totalDebtAmountVEF').textContent = this.formatVEF(totalSystemDebt);

        this.renderDailyChart();
    }

    renderDailyChart() {
        const range = parseInt(document.getElementById('chartTimeRange').value) || 1;
        const now = new Date();
        const startOfRange = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (range - 1)).getTime();

        const filteredPayments = this.transactions.filter(t => t.type === 'PAYMENT' && t.createdAt >= startOfRange);
        const filteredSales = this.transactions.filter(t => t.type === 'SALE' && t.createdAt >= startOfRange);

        // Update Labels and Totals based on range
        const titleEl = document.getElementById('statsSummaryTitle');
        const collectedLabelEl = document.getElementById('collectedLabel');
        const salesLabelEl = document.getElementById('salesLabel');

        if (range === 1) {
            titleEl.textContent = 'Resumen del Día';
            collectedLabelEl.textContent = 'Cobrado Hoy';
            salesLabelEl.textContent = 'Ventas Hoy';
        } else {
            titleEl.textContent = `Resumen (${range} días)`;
            collectedLabelEl.textContent = 'Cobro Total';
            salesLabelEl.textContent = 'Ventas Totales';
        }

        document.getElementById('todayCollectedAmount').textContent = this.formatCurrency(filteredPayments.reduce((acc, t) => acc + t.amount, 0));
        document.getElementById('todaySalesAmount').textContent = this.formatCurrency(filteredSales.reduce((acc, t) => acc + t.amount, 0));

        // Morose count
        const moroseCount = this.clients.filter(c => this.isClientMorose(c.id)).length;
        document.getElementById('moroseClientsCount').textContent = moroseCount;

        const ctx = document.getElementById('dailyPaymentsChart').getContext('2d');
        const emptyState = document.getElementById('emptyChartState');

        if (filteredPayments.length === 0) {
            if (this.paymentsChart) this.paymentsChart.destroy();
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');

        let labels = [];
        let dataPoints = [];

        if (range === 1) {
            // Group by hour for today
            labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
            dataPoints = Array.from({ length: 24 }, (_, h) => {
                const hStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h).getTime();
                const hEnd = hStart + 3600000;
                return filteredPayments
                    .filter(t => t.createdAt >= hStart && t.createdAt < hEnd)
                    .reduce((acc, t) => acc + t.amount, 0);
            });
        } else {
            // Group by date for ranges
            for (let i = range - 1; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
                labels.push(this.formatShortDate(d));

                const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
                const dEnd = dStart + 86400000;

                const daySum = filteredPayments
                    .filter(t => t.createdAt >= dStart && t.createdAt < dEnd)
                    .reduce((acc, t) => acc + t.amount, 0);
                dataPoints.push(daySum);
            }
        }

        if (this.paymentsChart) this.paymentsChart.destroy();

        this.paymentsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Pagos ($)',
                    data: dataPoints,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: range === 1 ? 0 : 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', font: { size: 10 } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: '#94a3b8',
                            font: { size: 10 },
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 7
                        }
                    }
                }
            }
        });
    }

    formatShortDate(date) {
        return new Intl.DateTimeFormat('es-VE', { month: 'short', day: 'numeric' }).format(date);
    }

    isClientMorose(clientId) {
        const balance = this.getClientBalance(clientId);
        if (balance <= 0) return false;

        const clientTxs = this.transactions
            .filter(t => t.clientId === clientId && t.type === 'PAYMENT')
            .sort((a, b) => b.createdAt - a.createdAt);

        if (clientTxs.length === 0) {
            // Check if client was created more than a month ago
            const client = this.getClient(clientId);
            const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            return client.createdAt < oneMonthAgo;
        }

        const lastPaymentDate = clientTxs[0].createdAt;
        const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        return lastPaymentDate < oneMonthAgo;
    }

    renderClientsTable(searchTerm = '') {
        const tbody = document.getElementById('clientsTableBody');
        const emptyState = document.getElementById('emptyClientsState');
        tbody.innerHTML = '';

        const filter = searchTerm.toLowerCase();
        const filteredClients = this.clients.filter(c =>
            c.name.toLowerCase().includes(filter) ||
            (c.email && c.email.toLowerCase().includes(filter))
        );

        if (this.clients.length === 0) {
            document.querySelector('.data-table').classList.add('hidden');
            emptyState.classList.remove('hidden');
            return;
        } else {
            document.querySelector('.data-table').classList.remove('hidden');
            emptyState.classList.add('hidden');
        }

        filteredClients.forEach(client => {
            const balance = this.getClientBalance(client.id);
            const isMorose = this.isClientMorose(client.id);
            const tr = document.createElement('tr');

            tr.innerHTML = `
                <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div class="avatar" style="width:32px; height:32px; font-size:12px;">${this.getInitials(client.name)}</div>
                        <div>
                            <span style="font-weight:500; display:block;">${client.name}</span>
                            ${isMorose ? `<span class="morose-alert"><i class="ph ph-warning"></i> +1 mes sin abono</span>` : ''}
                        </div>
                    </div>
                </td>
                <td>
                    <div style="font-size:0.85rem; color:var(--text-secondary)">
                        ${client.category ? `<span class="badge" style="background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; font-size:10px; margin-bottom:4px; display:inline-block;">${client.category}</span><br>` : ''}
                        ${client.phone ? `<i class="ph ph-phone"></i> ${client.phone}<br>` : ''}
                        ${client.email ? `<i class="ph ph-envelope"></i> ${client.email}` : ''}
                    </div>
                </td>
                <td style="font-weight:600;">
                    <div style="color: ${balance > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">${this.formatCurrency(balance)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 400;">${this.formatVEF(balance)}</div>
                </td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick="app.viewClientProfile('${client.id}')">
                        Ver Perfil
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // --- Clients Logic ---

    async handleClientSubmit() {
        const idInput = document.getElementById('clientId').value;
        const name = document.getElementById('clientName').value;
        const category = document.getElementById('clientCategory').value;
        const phone = document.getElementById('clientPhone').value;
        const email = document.getElementById('clientEmail').value;
        const address = document.getElementById('clientAddress').value;

        if (!name.trim()) return;

        if (idInput) {
            // Edit existing
            const { error } = await this.supabase.from('clients').update({
                name, category, phone, email, address
            }).eq('local_id', idInput).eq('user_id', this.user.id);

            if (error) {
                await this.supabase.from('clients').update({
                    name, category, phone, email, address
                }).eq('id', idInput).eq('user_id', this.user.id);
            }
            this.showToast('Cliente actualizado');
        } else {
            // Create new
            const localId = this.getUniqueId();
            const { error } = await this.supabase.from('clients').insert({
                name, category, phone, email, address,
                local_id: localId,
                user_id: this.user.id
            });

            if (error) {
                console.error("Supabase Error:", error);
                this.showToast('Error al registrar cliente: ' + error.message, 'error');
                return;
            }
            this.showToast('Cliente registrado con éxito');
        }

        await this.saveData();
        this.switchView('clients-view');
    }

    resetClientForm() {
        document.getElementById('clientForm').reset();
        document.getElementById('clientId').value = '';
        document.getElementById('clientFormTitle').textContent = 'Registrar Nuevo Cliente';
    }

    prepareEditClient() {
        const client = this.getClient(this.currentClientId);
        if (!client) return;

        // Switch view first (this triggers the built-in form reset)
        this.switchView('add-client-view');

        // Then populate Form
        document.getElementById('clientId').value = client.id;
        document.getElementById('clientName').value = client.name;
        document.getElementById('clientCategory').value = client.category || '';
        document.getElementById('clientPhone').value = client.phone || '';
        document.getElementById('clientEmail').value = client.email || '';
        document.getElementById('clientAddress').value = client.address || '';

        // Change UI Title
        document.getElementById('clientFormTitle').textContent = 'Editar Cliente: ' + client.name;
    }

    viewClientProfile(id) {
        this.currentClientId = id;
        this.renderClientProfile(id);
        this.switchView('client-profile-view');
    }

    renderClientProfile(id) {
        const client = this.getClient(id);
        if (!client) return;

        const balance = this.getClientBalance(id);

        document.getElementById('profileInitials').textContent = this.getInitials(client.name);
        document.getElementById('profileName').textContent = client.name;

        let contactInfo = [];
        if (client.category) contactInfo.push(client.category);
        if (client.email) contactInfo.push(client.email);
        if (client.phone) contactInfo.push(client.phone);
        document.getElementById('profileContactInfo').textContent = contactInfo.join(' | ') || 'Sin información de contacto';

        const debtEl = document.getElementById('profileCurrentDebt');
        debtEl.textContent = this.formatCurrency(balance);
        debtEl.className = balance > 0 ? 'text-danger' : 'text-success';

        const debtVefEl = document.getElementById('profileCurrentDebtVEF');
        debtVefEl.textContent = this.formatVEF(balance);

        // Render transactions timeline
        const timeline = document.getElementById('transactionsTimeline');
        const emptyState = document.getElementById('emptyTransactionsState');
        timeline.innerHTML = '';

        const clientTxs = this.transactions
            .filter(t => t.clientId === id)
            .sort((a, b) => b.createdAt - a.createdAt);

        if (clientTxs.length === 0) {
            emptyState.classList.remove('hidden');
        } else {
            emptyState.classList.add('hidden');
            clientTxs.forEach(tx => {
                const isSale = tx.type === 'SALE';
                const el = document.createElement('div');
                el.className = `tx-item ${isSale ? 'sale' : 'payment'}`;

                el.innerHTML = `
                    <div class="tx-info">
                        <h4>${tx.description}</h4>
                        <span>${this.formatDate(tx.createdAt)} • ${isSale ? 'Venta (Deuda)' : 'Abono'}</span>
                    </div>
                    <div class="tx-amount ${isSale ? 'text-danger' : 'text-success'}" style="text-align: right;">
                        <div>${isSale ? '-' : '+'}${this.formatCurrency(tx.amount)}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 400;">${this.formatVEF(tx.amount)}</div>
                    </div>
                `;
                timeline.appendChild(el);
            });
        }
    }

    // --- Transactions Logic ---

    openTransactionModal(type) {
        document.getElementById('txType').value = type;
        const title = type === 'SALE' ? 'Registrar Nueva Venta (Aumento de Deuda)' : 'Registrar Abono (Reducción de Deuda)';
        document.getElementById('txModalTitle').textContent = title;
        document.getElementById('transactionForm').reset();

        const modal = document.getElementById('transactionModal');
        modal.classList.remove('hidden');
        // Let reflow happen for animation
        setTimeout(() => modal.classList.add('active'), 10);
    }

    closeTransactionModal() {
        const modal = document.getElementById('transactionModal');
        modal.classList.remove('active');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }

    async handleTransactionSubmit() {
        const type = document.getElementById('txType').value;
        const amount = parseFloat(document.getElementById('txAmount').value);
        const description = document.getElementById('txDescription').value;

        if (!amount || amount <= 0 || !description.trim()) return;

        // Get the remote UUID for the client
        const localClient = this.clients.find(c => c.id === this.currentClientId);
        // Find by local_id in Supabase
        const { data: clients } = await this.supabase.from('clients').select('id').eq('local_id', this.currentClientId);
        let remoteClientId = clients && clients[0] ? clients[0].id : this.currentClientId;

        const { error } = await this.supabase.from('transactions').insert({
            client_id: remoteClientId,
            type,
            amount,
            description,
            local_id: this.getUniqueId(),
            user_id: this.user.id
        });

        if (error) {
            console.error("Supabase Error:", error);
            this.showToast('Error al registrar transacción', 'error');
            return;
        }

        await this.saveData();
        this.closeTransactionModal();
        this.showToast(type === 'SALE' ? 'Venta registrada' : 'Abono registrado');
    }
}

// Initialize App
const app = new AccountsApp();
window.app = app; // Expose globally for inline onclick handlers
