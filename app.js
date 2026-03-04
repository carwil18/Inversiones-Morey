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

        // Global Transactions filters
        document.getElementById('txFilterType').addEventListener('change', () => {
            this.renderGlobalTransactions();
        });
        document.getElementById('txFilterDate').addEventListener('change', () => {
            this.renderGlobalTransactions();
        });

        // Transaction Modal
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', () => this.closeTransactionModal());
        });

        document.getElementById('transactionForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleTransactionSubmit();
        });

        // Mobile Sidebar Toggle
        const openSidebarBtn = document.getElementById('openSidebarBtn');
        const closeSidebarBtn = document.getElementById('closeSidebarBtn');
        const sidebarOverlay = document.getElementById('sidebar-overlay');
        const sidebar = document.getElementById('sidebar');

        const toggleSidebar = (forceClose = false) => {
            if (forceClose) {
                sidebar.classList.remove('active');
                sidebarOverlay.classList.remove('active');
            } else {
                sidebar.classList.toggle('active');
                sidebarOverlay.classList.toggle('active');
            }
        };

        if (openSidebarBtn) openSidebarBtn.addEventListener('click', () => toggleSidebar());
        if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', () => toggleSidebar(true));
        if (sidebarOverlay) sidebarOverlay.addEventListener('click', () => toggleSidebar(true));

        // Auto-close sidebar on mobile when navigating
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    toggleSidebar(true);
                }
            });
        });
    }

    bindAuthEvents() {
        const loginForm = document.getElementById('loginForm');
        const toggleBtn = document.getElementById('toggleAuthBtn');
        const passwordToggle = document.getElementById('togglePasswordVisibility');

        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAuthSubmit();
        });

        toggleBtn.addEventListener('click', () => this.toggleAuthMode());

        passwordToggle.addEventListener('click', () => {
            const pwdInput = document.getElementById('loginPassword');
            const icon = passwordToggle.querySelector('i');
            if (pwdInput.type === 'password') {
                pwdInput.type = 'text';
                icon.className = 'ph ph-eye-slash';
            } else {
                pwdInput.type = 'password';
                icon.className = 'ph ph-eye';
            }
        });
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
        const emailInput = document.getElementById('loginEmail');
        const passwordInput = document.getElementById('loginPassword');
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const btn = document.getElementById('loginBtn');

        if (!email || !password) {
            this.showToast('Por favor completa todos los campos', 'error');
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-circle-notch animate-spin"></i> Procesando...';

        try {
            if (this.isSignUp) {
                const { data, error } = await this.supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: window.location.origin
                    }
                });

                if (error) throw error;

                // Check if user was created but needs confirmation
                if (data.user && !data.session) {
                    this.showToast('¡Registro casi listo! Revisa tu correo (' + email + ') para confirmar tu cuenta.', 'info');
                    // Reset form to login mode
                    this.toggleAuthMode();
                } else if (data.session) {
                    this.handleAuthStateChange(data.user);
                    this.showToast('¡Bienvenido!');
                }
            } else {
                const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
                if (error) {
                    if (error.message.includes('Email not confirmed')) {
                        throw new Error('Debes confirmar tu correo antes de entrar. Revisa tu bandeja de entrada o spam.');
                    }
                    throw error;
                }
                this.handleAuthStateChange(data.user);
                this.showToast('Sesión iniciada');
            }
        } catch (error) {
            console.error("Auth Error:", error);
            let msg = error.message;
            if (msg === 'Invalid login credentials') msg = 'Correo o contraseña incorrectos';
            this.showToast(msg, 'error');
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

        try {
            const { data: rawClients, error: cErr } = await this.supabase
                .from('clients')
                .select('*')
                .eq('user_id', this.user.id);

            const { data: rawTransactions, error: tErr } = await this.supabase
                .from('transactions')
                .select('*')
                .eq('user_id', this.user.id);

            if (cErr) throw cErr;
            if (tErr) throw tErr;

            if (rawClients) {
                this.clients = rawClients.map(c => ({
                    ...c,
                    id: String(c.local_id || c.id), // Use local_id for app logic routing
                    uuid: String(c.id),           // Always keep DB UUID for matching
                    // Normalize numeric fields strictly
                    total_debt: parseFloat(c.total_debt || 0),
                    total_payments: parseFloat(c.total_payments || 0),
                    createdAt: new Date(c.created_at).getTime()
                }));
            }

            if (rawTransactions) {
                this.transactions = rawTransactions.map(t => ({
                    ...t,
                    id: String(t.local_id || t.id),
                    clientId: String(t.client_id), // Link using strictly DB UUID
                    amount: parseFloat(t.amount || 0),
                    createdAt: new Date(t.created_at).getTime()
                }));
            }
        } catch (err) {
            console.error("Sync Error:", err);
            this.showToast('Error al sincronizar con la nube', 'error');
        }
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
        const client = this.getClient(clientId);
        if (!client) return 0;

        const clientUuid = String(client.uuid).toLowerCase();
        const txs = (this.transactions || []).filter(t =>
            String(t.clientId).toLowerCase() === clientUuid
        );

        // Use pre-calculated totals from client object if no transactions are found
        // or if the sum differs (prioritize pre-calculated for parity with table)
        if (txs.length === 0) {
            return client.total_debt - client.total_payments;
        }

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

        // Header and Specific actions
        const topHeaderTitle = document.querySelector('.top-header h1');

        if (viewId === 'dashboard-view') {
            topHeaderTitle.textContent = 'Dashboard';
            this.renderDashboard();
        } else if (viewId === 'clients-view') {
            topHeaderTitle.textContent = 'Mis Clientes';
            document.getElementById('globalSearchInput').value = '';
            this.renderClientsTable('');
        } else if (viewId === 'add-client-view') {
            topHeaderTitle.textContent = this.currentClientId ? 'Editar Cliente' : 'Nuevo Cliente';
            this.resetClientForm();
        } else if (viewId === 'client-profile-view') {
            const client = this.getClient(this.currentClientId); // Fetch client first
            topHeaderTitle.textContent = client ? client.name : 'Perfil de Cliente';
        } else if (viewId === 'transactions-view') {
            topHeaderTitle.textContent = 'Historial de Transacciones';
            this.renderGlobalTransactions();
        } else if (viewId === 'converter-view') {
            topHeaderTitle.textContent = 'Convertidor';
            document.getElementById('converterRateDisplay').textContent = `Tasa actual: 1$ = ${this.exchangeRate.toFixed(2)} Bs.`;
        } else if (viewId === 'data-management-view') {
            topHeaderTitle.textContent = 'Base de Datos';
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
            const totalSales = client.total_debt;
            const totalPayments = client.total_payments;

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
                <td style="color:var(--text-secondary)">${this.formatCurrency(totalSales)}</td>
                <td style="color:var(--accent-green)">${this.formatCurrency(totalPayments)}</td>
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

    async deleteCurrentClient() {
        const client = this.getClient(this.currentClientId);
        if (!client) return;

        if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente a "${client.name}" y todo su historial de transacciones? Esta acción no se puede deshacer.`)) {
            return;
        }

        try {
            const dbUuid = client.uuid;

            // Delete all associated transactions first
            const { error: txError } = await this.supabase.from('transactions')
                .delete()
                .eq('client_id', dbUuid)
                .eq('user_id', this.user.id);

            if (txError) throw txError;

            // Delete the client
            const { error: clientError } = await this.supabase.from('clients')
                .delete()
                .eq('id', dbUuid)
                .eq('user_id', this.user.id);

            if (clientError) throw clientError;

            this.showToast('Cliente y su historial eliminados', 'success');

            await this.saveData();
            this.switchView('clients-view');

        } catch (error) {
            console.error("Delete Error:", error);
            this.showToast('Error al eliminar cliente', 'error');
        }
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

        const clientUuid = String(client.uuid).toLowerCase();
        const clientTxs = (this.transactions || [])
            .filter(t => String(t.clientId).toLowerCase() === clientUuid)
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
                        <h4>${tx.description || (isSale ? 'Venta' : 'Abono')}</h4>
                        <span>${this.formatDate(tx.createdAt)} • ${isSale ? 'Venta (Deuda)' : 'Abono'}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <div class="tx-amount ${isSale ? 'text-danger' : 'text-success'}" style="text-align: right;">
                            <div>${isSale ? '+' : '-'}${this.formatCurrency(tx.amount)}</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 400;">${this.formatVEF(tx.amount)}</div>
                        </div>
                        <button class="icon-btn-sm" onclick="app.generatePDF('${tx.id}')" title="Descargar Recibo">
                            <i class="ph ph-download-simple"></i>
                        </button>
                    </div>
                `;
                timeline.appendChild(el);
            });
        }
    }

    renderGlobalTransactions() {
        const timeline = document.getElementById('globalTransactionsTimeline');
        const emptyState = document.getElementById('emptyGlobalTransactionsState');
        timeline.innerHTML = '';

        const typeFilter = document.getElementById('txFilterType').value;
        const dateFilter = document.getElementById('txFilterDate').value;
        const now = new Date();

        let allTxs = [...(this.transactions || [])];

        // Apply Type Filter
        if (typeFilter !== 'ALL') {
            allTxs = allTxs.filter(t => t.type === typeFilter);
        }

        // Apply Date Filter
        if (dateFilter !== 'ALL') {
            let limitTimestamp = 0;
            if (dateFilter === 'TODAY') {
                limitTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            } else if (dateFilter === 'WEEK') {
                limitTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime();
            } else if (dateFilter === 'MONTH') {
                limitTimestamp = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
            }
            allTxs = allTxs.filter(t => t.createdAt >= limitTimestamp);
        }

        allTxs.sort((a, b) => b.createdAt - a.createdAt);

        if (allTxs.length === 0) {
            emptyState.classList.remove('hidden');
        } else {
            emptyState.classList.add('hidden');
            allTxs.forEach(tx => {
                const clientUuid = String(tx.clientId).toLowerCase();
                const client = this.clients.find(c => String(c.uuid).toLowerCase() === clientUuid || String(c.id).toLowerCase() === clientUuid);
                const clientName = client ? client.name : 'Cliente Eliminado/Desconocido';

                const isSale = tx.type === 'SALE';
                const el = document.createElement('div');
                el.className = `tx-item ${isSale ? 'sale' : 'payment'}`;

                el.innerHTML = `
                    <div class="tx-info">
                        <h4>${tx.description || (isSale ? 'Venta' : 'Abono')}</h4>
                        <span>${this.formatDate(tx.createdAt)} • ${isSale ? 'Venta (Deuda)' : 'Abono'} • <strong>${clientName}</strong></span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <div class="tx-amount ${isSale ? 'text-danger' : 'text-success'}" style="text-align: right;">
                            <div>${isSale ? '+' : '-'}${this.formatCurrency(tx.amount)}</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 400;">${this.formatVEF(tx.amount)}</div>
                        </div>
                        <button class="icon-btn-sm" onclick="app.generatePDF('${tx.id}')" title="Descargar Recibo">
                            <i class="ph ph-download-simple"></i>
                        </button>
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

        const dbClient = this.clients.find(c => c.id === this.currentClientId);
        if (!dbClient) {
            this.showToast('Error: Cliente no encontrado', 'error');
            return;
        }

        const remoteClientId = dbClient.uuid;

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

    sendWhatsApp() {
        const client = this.getClient(this.currentClientId);
        if (!client) return;

        const balance = this.getClientBalance(client.id);

        // Remove non numeric chars except '+', just in case
        let phone = client.phone ? client.phone.replace(/[^\d+]/g, '') : '';

        if (!phone) {
            this.showToast('El cliente no tiene un número registrado.', 'error');
            return;
        }

        let msg = `Hola ${client.name},\n\nTe escribimos de *Inversiones Morey*.\n`;

        if (balance > 0) {
            msg += `Queremos recordarte gentilmente que tienes un saldo pendiente de *${this.formatCurrency(balance)}* (${this.formatVEF(balance)}).\n\nQuedamos atentos a tu abono. ¡Feliz día!`;
        } else if (balance === 0) {
            msg += `Solo pasábamos para saludarte y confirmar que tu saldo actual es de *${this.formatCurrency(0)}*.\n\n¡Gracias por preferirnos!`;
        } else {
            msg += `Tienes un saldo a favor con nosotros de *${this.formatCurrency(Math.abs(balance))}*.\n\n¡Gracias por tu confianza!`;
        }

        const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
        window.open(url, '_blank');
    }

    generatePDF(txId) {
        const tx = this.transactions.find(t => String(t.id) === String(txId) || String(t.local_id) === String(txId));
        if (!tx) return;

        const clientUuid = String(tx.clientId).toLowerCase();
        const client = this.clients.find(c => String(c.uuid).toLowerCase() === clientUuid || String(c.id).toLowerCase() === clientUuid);
        const clientName = client ? client.name : 'Cliente Desconocido';
        const clientPhone = client ? client.phone || 'N/A' : 'N/A';
        const clientAddress = client ? client.address || 'N/A' : 'N/A';

        const isSale = tx.type === 'SALE';
        const typeLabel = isSale ? 'Factura de Venta' : 'Recibo de Abono';

        // Hidden element to compile PDF template
        const printArea = document.createElement('div');
        printArea.style.padding = '40px';
        printArea.style.background = 'white';
        printArea.style.color = 'black';
        printArea.style.fontFamily = 'Inter, sans-serif';
        printArea.style.width = '800px';

        printArea.innerHTML = `
            <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 20px; display: flex; justify-content: space-between;">
                <div>
                    <h1 style="color: #0f172a; margin: 0; font-size: 24px;">INVERSIONES MOREY</h1>
                    <p style="color: #64748b; margin: 5px 0 0 0; font-size: 14px;">Gestión de Cobranzas y Ventas</p>
                </div>
                <div style="text-align: right;">
                    <h2 style="color: ${isSale ? '#ef4444' : '#10b981'}; margin: 0; font-size: 20px;">${typeLabel}</h2>
                    <p style="color: #64748b; margin: 5px 0 0 0; font-size: 14px;">Fecha: ${new Date(tx.createdAt).toLocaleDateString('es-VE')}</p>
                </div>
            </div>
            
            <div style="display: flex; margin-bottom: 30px;">
                <div style="flex: 1;">
                    <h3 style="color: #0f172a; font-size: 16px; margin: 0 0 10px 0;">Datos del Cliente</h3>
                    <p style="margin: 0; font-size: 14px; color: #334155;"><strong>Nombre:</strong> ${clientName}</p>
                    <p style="margin: 5px 0 0 0; font-size: 14px; color: #334155;"><strong>Teléfono:</strong> ${clientPhone}</p>
                    <p style="margin: 5px 0 0 0; font-size: 14px; color: #334155;"><strong>Dirección:</strong> ${clientAddress}</p>
                </div>
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
                <thead>
                    <tr style="background-color: #f1f5f9;">
                        <th style="padding: 12px; text-align: left; color: #0f172a; border-bottom: 1px solid #cbd5e1;">Descripción</th>
                        <th style="padding: 12px; text-align: right; color: #0f172a; border-bottom: 1px solid #cbd5e1;">Monto (USD)</th>
                        <th style="padding: 12px; text-align: right; color: #0f172a; border-bottom: 1px solid #cbd5e1;">Eq. Bolívares</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #334155;">${tx.description || (isSale ? 'Venta general' : 'Abono general')}</td>
                        <td style="padding: 12px; text-align: right; border-bottom: 1px solid #e2e8f0; color: #334155; font-weight: bold;">${this.formatCurrency(tx.amount)}</td>
                        <td style="padding: 12px; text-align: right; border-bottom: 1px solid #e2e8f0; color: #334155;">${this.formatVEF(tx.amount)}</td>
                    </tr>
                </tbody>
            </table>

            <div style="margin-top: 50px; text-align: center; color: #64748b; font-size: 12px;">
                <p>Generado por Inversiones Morey - Tasa referencial BCV: ${this.exchangeRate.toFixed(2)} Bs.</p>
                <p>Este documento es un comprobante de control interno.</p>
            </div>
        `;

        document.body.appendChild(printArea);

        const opt = {
            margin: 0.5,
            filename: `${isSale ? 'Venta' : 'Abono'}_${clientName.replace(/\s+/g, '_')}_${new Date(tx.createdAt).toISOString().split('T')[0]}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
        };

        html2pdf().from(printArea).set(opt).save().then(() => {
            document.body.removeChild(printArea);
            this.showToast('Recibo PDF generado con éxito');
        }).catch(err => {
            console.error("PDF Error: ", err);
            document.body.removeChild(printArea);
            this.showToast('Error al generar PDF', 'error');
        });
    }
}

// Initialize App
const app = new AccountsApp();
window.app = app; // Expose globally for inline onclick handlers
