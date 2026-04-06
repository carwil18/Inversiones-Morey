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
        this.exchangeRateEUR = parseFloat(localStorage.getItem('ar_exchange_rate_eur')) || 1;
        this.activeCurrency = localStorage.getItem('ar_active_currency') || 'USD';
        this.converterMode = 'USD';
        this.rateHistory = JSON.parse(localStorage.getItem('ar_rate_history')) || [];
        this.paymentsChart = null;
        this.categoryDebtChart = null;
        this.theme = localStorage.getItem('ar_theme') || 'dark';
        this.clientsLimit = 30;
        this.txLimit = 30;

        this.init();
    }

    escapeHTML(str) {
        if (typeof str !== 'string') return str;
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    animateValue(id, start, end, duration, isCurrency = false) {
        const obj = document.getElementById(id);
        if (!obj) return;
        
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const current = progress * (end - start) + start;
            
            if (isCurrency) {
                obj.textContent = this.formatCurrency(current);
            } else {
                obj.textContent = Math.floor(current);
            }

            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }

    async init() {
        this.applyTheme(this.theme);
        const rate = this.activeCurrency === 'USD' ? this.exchangeRate : this.exchangeRateEUR;
        document.getElementById('exchangeRateInput').value = rate.toFixed(2);
        this.updateHeaderUI();
        this.bindEvents();
        this.bindAuthEvents();

        // Check for existing session
        const { data: { session } } = await this.supabase.auth.getSession();
        if (session) {
            this.handleAuthStateChange(session.user);
        }

        // Password Recovery Listener
        this.supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                const modal = document.getElementById('updatePwdModal');
                if (modal) {
                    modal.classList.remove('hidden');
                    setTimeout(() => modal.classList.add('active'), 10);
                }
            }
        });

        this.fetchBCVRate(); // Sync on load
    }
    async confirmAction(title, message, isDanger = true) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmModal');
            document.getElementById('confirmModalTitle').textContent = title;
            document.getElementById('confirmModalMessage').textContent = message;

            const acceptBtn = document.getElementById('confirmAcceptBtn');
            const cancelBtn = document.getElementById('confirmCancelBtn');

            if (isDanger) {
                acceptBtn.className = 'btn btn-danger';
            } else {
                acceptBtn.className = 'btn btn-primary';
            }

            const cleanup = () => {
                acceptBtn.removeEventListener('click', onAccept);
                cancelBtn.removeEventListener('click', onCancel);
                modal.classList.remove('active');
                setTimeout(() => modal.classList.add('hidden'), 300);
            };

            const onAccept = () => { cleanup(); resolve(true); };
            const onCancel = () => { cleanup(); resolve(false); };

            acceptBtn.addEventListener('click', onAccept);
            cancelBtn.addEventListener('click', onCancel);

            modal.classList.remove('hidden');
            setTimeout(() => modal.classList.add('active'), 10);
        });
    }

    exportTransactionsCSV(clientOnly = false) {
        let txsToExport = [];
        if (clientOnly && this.currentClientId) {
            const dbClient = this.clients.find(c => c.id === this.currentClientId);
            txsToExport = this.transactions.filter(t => String(t.clientId).toLowerCase() === String(dbClient.uuid).toLowerCase());
        } else {
            txsToExport = [...this.transactions];
        }

        if (txsToExport.length === 0) {
            this.showToast('No hay transacciones para exportar', 'info');
            return;
        }

        txsToExport.sort((a, b) => b.createdAt - a.createdAt);

        const headers = ['Fecha', 'Tipo', 'Cliente', 'Descripción', 'Monto (USD)', 'Monto VEF Historico', 'Método de Pago'];
        const csvRows = [headers.join(',')];

        txsToExport.forEach(tx => {
            const clientUuid = String(tx.clientId).toLowerCase();
            const client = this.clients.find(c => String(c.uuid).toLowerCase() === clientUuid || String(c.id).toLowerCase() === clientUuid);
            const clientName = client ? client.name.replace(/,/g, '') : 'Desconocido';

            let displayDesc = (tx.description || '').replace(/,/g, ' ');
            let historicalRate = this.exchangeRate;
            if (displayDesc.includes('| Tasa:')) {
                const parts = displayDesc.split('| Tasa:');
                displayDesc = parts[0].trim();
                historicalRate = parseFloat(parts[1].trim()) || this.exchangeRate;
            }

            const vefAmount = (tx.amount * historicalRate).toFixed(2);
            const dateStr = new Date(tx.createdAt).toLocaleString().replace(/,/g, '');
            const typeStr = tx.type === 'SALE' ? 'Venta (Deuda)' : 'Abono';
            const pm = tx.payment_method || 'N/A';

            csvRows.push(`${dateStr},${typeStr},${clientName},${displayDesc},${tx.amount},${vefAmount},${pm}`);
        });

        const csvString = "\uFEFF" + csvRows.join('\n'); // Add BOM for Excel UTF-8
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = clientOnly ? `Historial_Cliente_${new Date().getTime()}.csv` : `Historial_General_${new Date().getTime()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        this.showToast('Exportación descargada con éxito', 'success');
    }

    bindEvents() {
        // Theme Toggle
        const themeToggleBtn = document.getElementById('themeToggleBtn');
        if (themeToggleBtn) themeToggleBtn.addEventListener('click', () => this.toggleTheme());

        // Pagination Load More
        const loadMoreClientsBtn = document.getElementById('loadMoreClientsBtn');
        if (loadMoreClientsBtn) {
            loadMoreClientsBtn.addEventListener('click', () => {
                this.clientsLimit += 30;
                this.renderClientsTable(document.getElementById('globalSearchInput').value);
            });
        }

        const loadMoreTxBtn = document.getElementById('loadMoreTxBtn');
        if (loadMoreTxBtn) {
            loadMoreTxBtn.addEventListener('click', () => {
                this.txLimit += 30;
                this.renderGlobalTransactions();
            });
        }

        // Main Navigation
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetId = e.currentTarget.dataset.target;
                if (targetId) this.switchView(targetId);
            });
        });

        // Search & Category Filter
        document.getElementById('globalSearchInput').addEventListener('input', (e) => {
            this.clientsLimit = 30;
            this.renderClientsTable(e.target.value);
        });

        const categoryFilter = document.getElementById('clientCategoryFilter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', () => {
                this.clientsLimit = 30;
                this.renderClientsTable(document.getElementById('globalSearchInput').value);
            });
        }

        // Logout
        document.getElementById('logoutBtn').addEventListener('click', () => this.handleLogout());
        const logoutBtnMobile = document.getElementById('logoutBtnMobile');
        if (logoutBtnMobile) logoutBtnMobile.addEventListener('click', () => this.handleLogout());

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

        // Profile Transactions Search & Filter
        const profileTxSearch = document.getElementById('profileTxSearch');
        const profileTxFilter = document.getElementById('profileTxFilterType');
        const profileTxDateFilter = document.getElementById('profileTxFilterDate');
        if (profileTxSearch) {
            profileTxSearch.addEventListener('input', () => this.renderClientProfile(this.currentClientId));
        }
        if (profileTxFilter) {
            profileTxFilter.addEventListener('change', () => this.renderClientProfile(this.currentClientId));
        }
        if (profileTxDateFilter) {
            profileTxDateFilter.addEventListener('change', () => this.renderClientProfile(this.currentClientId));
        }

        // Currency Toggle in Header
        document.querySelectorAll('#headerCurrencySwitch button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const curr = e.target.dataset.curr;
                this.setActiveCurrency(curr);
            });
        });

        // Converter Currency Tabs
        document.querySelectorAll('#converterCurrencyTabs button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.target.dataset.mode;
                this.setConverterMode(mode);
            });
        });

        // Converter logic
        const convUSD = document.getElementById('convUSD');
        const convVEF = document.getElementById('convVEF');

        convUSD.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            const rate = this.converterMode === 'EUR' ? this.exchangeRateEUR : this.exchangeRate;
            if (!isNaN(val)) {
                convVEF.value = (val * rate).toFixed(2);
            } else {
                convVEF.value = '';
            }
        });

        convVEF.addEventListener('input', (e) => {
            const vef = parseFloat(e.target.value);
            const rate = this.converterMode === 'EUR' ? this.exchangeRateEUR : this.exchangeRate;
            if (!isNaN(vef)) {
                convUSD.value = (vef / rate).toFixed(2);
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
            this.txLimit = 30;
            this.renderGlobalTransactions();
        });
        document.getElementById('txFilterDate').addEventListener('change', () => {
            this.txLimit = 30;
            this.renderGlobalTransactions();
        });

        // Transaction Modal
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', () => this.closeTransactionModal());
        });

        document.getElementById('transactionForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleTransactionSubmit(e.submitter);
        });

        // Items logic for Sales
        const itemsContainer = document.getElementById('txItemsContainer');
        if (itemsContainer) {
            itemsContainer.addEventListener('input', (e) => {
                if (e.target.classList.contains('item-qty') || e.target.classList.contains('item-price')) {
                    const row = e.target.closest('.item-row');
                    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
                    const price = parseFloat(row.querySelector('.item-price').value) || 0;
                    const subtotal = qty * price;
                    row.querySelector('.item-subtotal').textContent = '$' + subtotal.toFixed(2);

                    // Update total amount in parent form
                    let total = 0;
                    itemsContainer.querySelectorAll('.item-row').forEach(r => {
                        const q = parseFloat(r.querySelector('.item-qty').value) || 0;
                        const p = parseFloat(r.querySelector('.item-price').value) || 0;
                        total += q * p;
                    });
                    if (total > 0) {
                        document.getElementById('txAmount').value = total.toFixed(2);
                    }
                }
            });
        }

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

        // Mobile Bottom Nav Binding
        document.querySelectorAll('.mobile-nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetId = e.currentTarget.dataset.target;
                if (targetId) {
                    this.switchView(targetId);
                    document.querySelectorAll('.mobile-nav-item').forEach(i => i.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                }
            });
        });

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

        const forgotPwdBtn = document.getElementById('forgotPwdBtn');
        if (forgotPwdBtn) {
            forgotPwdBtn.addEventListener('click', () => this.handleForgotPassword());
        }

        // Update Password Logic
        const updatePwdForm = document.getElementById('updatePwdForm');
        const closeUpdatePwdBtn = document.getElementById('closeUpdatePwdBtn');
        if (updatePwdForm) {
            updatePwdForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleUpdatePassword();
            });
        }
        if (closeUpdatePwdBtn) {
            closeUpdatePwdBtn.addEventListener('click', () => {
                const modal = document.getElementById('updatePwdModal');
                modal.classList.remove('active');
                setTimeout(() => modal.classList.add('hidden'), 300);
            });
        }
    }

    // --- Theme Logic ---
    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const themeText = document.getElementById('themeToggleText');
        const themeIcon = document.querySelector('#themeToggleBtn i');
        if (theme === 'light') {
            if (themeText) themeText.textContent = 'Modo Oscuro';
            if (themeIcon) themeIcon.className = 'ph ph-moon';
        } else {
            if (themeText) themeText.textContent = 'Modo Claro';
            if (themeIcon) themeIcon.className = 'ph ph-sun';
        }
    }

    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('ar_theme', this.theme);
        this.applyTheme(this.theme);
        // Chart colors force update
        if (this.currentViewId === 'dashboard-view') {
            this.renderDashboard();
        }
    }

    // --- Auth Logic ---

    toggleAuthMode() {
        this.isSignUp = !this.isSignUp;
        const title = document.querySelector('.auth-header h2');
        const subtitle = document.getElementById('auth-subtitle');
        const btn = document.getElementById('loginBtn');
        const toggle = document.getElementById('toggleAuthBtn');
        const forgotBtn = document.getElementById('forgotPwdBtn');

        if (this.isSignUp) {
            title.textContent = 'Crear Cuenta';
            subtitle.textContent = 'Regístrate para comenzar a gestionar tus cuentas';
            btn.textContent = 'Registrarse';
            toggle.textContent = '¿Ya tienes cuenta? Inicia sesión';
            if (forgotBtn) forgotBtn.style.display = 'none';
        } else {
            title.textContent = 'Inversiones Morey';
            subtitle.textContent = 'Inicia sesión para gestionar tus cobranzas';
            btn.textContent = 'Entrar';
            toggle.textContent = '¿No tienes cuenta? Regístrate';
            if (forgotBtn) forgotBtn.style.display = 'block';
        }
    }

    async handleForgotPassword() {
        const emailInput = document.getElementById('loginEmail');
        const email = emailInput.value.trim();

        if (!email) {
            this.showToast('Ingresa tu correo en el campo superior primero', 'info');
            emailInput.focus();
            return;
        }

        const btn = document.getElementById('forgotPwdBtn');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-circle-notch animate-spin"></i> Enviando...';

        try {
            const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin
            });

            if (error) throw error;
            this.showToast('Te hemos enviado un correo. Revisa tu bandeja de entrada o spam.', 'success');
        } catch (error) {
            console.error("Forgot pwd error:", error);
            this.showToast('Error al procesar la solicitud', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    async handleUpdatePassword() {
        const newPassword = document.getElementById('newPassword').value;
        const btn = document.getElementById('updatePwdBtn');
        const originalText = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-circle-notch animate-spin"></i> Guardando...';

        try {
            const { error } = await this.supabase.auth.updateUser({ password: newPassword });
            if (error) throw error;

            this.showToast('¡Tu contraseña ha sido actualizada con éxito!', 'success');

            const modal = document.getElementById('updatePwdModal');
            modal.classList.remove('active');
            setTimeout(() => modal.classList.add('hidden'), 300);
            document.getElementById('updatePwdForm').reset();

        } catch (error) {
            console.error("Update pwd error:", error);
            this.showToast('No se pudo actualizar la contraseña', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
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

        // Show Skeletons
        this.toggleSkeletons(true);

        // First check if migration is needed
        const localClients = JSON.parse(localStorage.getItem('ar_clients')) || [];
        const localTransactions = JSON.parse(localStorage.getItem('ar_transactions')) || [];

        try {
            let { data: rawClients, error: cErr } = await this.supabase
                .from('clients')
                .select('*')
                .eq('user_id', this.user.id);

            let { data: rawTransactions, error: tErr } = await this.supabase
                .from('transactions')
                .select('*')
                .eq('user_id', this.user.id);

            if (cErr) throw cErr;
            if (tErr) throw tErr;

            // Migration logic: If cloud is empty but local storage has data
            if ((!rawClients || rawClients.length === 0) && localClients.length > 0) {
                console.log("Migrating local data to cloud...");
                await this.migrateLocalToSupabase(localClients, localTransactions);
                // After migration, re-fetch to get the proper UUIDs
                const { data: mc } = await this.supabase.from('clients').select('*').eq('user_id', this.user.id);
                const { data: mt } = await this.supabase.from('transactions').select('*').eq('user_id', this.user.id);
                rawClients = mc || [];
                rawTransactions = mt || [];
                // Clear local storage to prevent double migration
                localStorage.removeItem('ar_clients');
                localStorage.removeItem('ar_transactions');
            }

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
        } finally {
            this.toggleSkeletons(false);
        }
    }

    toggleSkeletons(show) {
        const containers = {
            'totalClientsCount': 'skeleton-text',
            'totalDebtAmount': 'skeleton-text',
            'totalMonthCollected': 'skeleton-text',
            'clientsTableBody': 'skeleton-table'
        };

        for (const [id, type] of Object.entries(containers)) {
            const el = document.getElementById(id);
            if (!el) continue;
            if (show) {
                if (id === 'clientsTableBody') {
                    el.innerHTML = Array(5).fill(0).map(() => `
                        <tr>
                            <td><div class="skeleton skeleton-text"></div></td>
                            <td><div class="skeleton skeleton-text"></div></td>
                            <td><div class="skeleton skeleton-text"></div></td>
                            <td><div class="skeleton skeleton-text"></div></td>
                            <td><div class="skeleton skeleton-text"></div></td>
                            <td><div class="skeleton skeleton-text"></div></td>
                        </tr>
                    `).join('');
                } else {
                    el.classList.add('skeleton', 'skeleton-text');
                }
            } else {
                el.classList.remove('skeleton', 'skeleton-text');
            }
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
        const symbol = this.activeCurrency === 'EUR' ? '€' : '$';
        const currCode = this.activeCurrency === 'EUR' ? 'EUR' : 'USD';
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currCode }).format(amount);
    }

    formatVEF(amount) {
        const rate = this.activeCurrency === 'EUR' ? this.exchangeRateEUR : this.exchangeRate;
        const vefAmount = amount * rate;
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
        btn.classList.add('loading');

        try {
            // Fetch USD
            const resUSD = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
            const dataUSD = await resUSD.json();
            if (dataUSD && dataUSD.promedio) {
                this.updateExchangeRate(dataUSD.promedio, 'USD');
            }

            // Fetch EUR
            const resEUR = await fetch('https://ve.dolarapi.com/v1/euros/oficial');
            const dataEUR = await resEUR.json();
            if (dataEUR && dataEUR.promedio) {
                this.updateExchangeRate(dataEUR.promedio, 'EUR');
            }

            this.showToast('Tasas sincronizadas con BCV');
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

    updateExchangeRate(rate, currency = 'USD') {
        if (currency === 'USD') {
            this.exchangeRate = rate;
            localStorage.setItem('ar_exchange_rate', rate);
        } else {
            this.exchangeRateEUR = rate;
            localStorage.setItem('ar_exchange_rate_eur', rate);
        }

        if (this.activeCurrency === currency) {
            document.getElementById('exchangeRateInput').value = rate.toFixed(2);
        }

        // Update converter display if currently in that view and mode matches sync
        const convDisplay = document.getElementById('converterRateDisplay');
        if (this.currentViewId === 'converter-view' && this.converterMode === currency) {
            const symbol = currency === 'EUR' ? '€' : '$';
            convDisplay.textContent = `Tasa actual: 1${symbol} = ${rate.toFixed(2)} Bs.`;
        }

        // Update history only for USD for simplicity in the sparkline
        if (currency === 'USD') {
            const today = new Date().toISOString().split('T')[0];
            const lastEntry = this.rateHistory[this.rateHistory.length - 1];

            if (!lastEntry || lastEntry.date !== today) {
                this.rateHistory.push({ date: today, rate: rate });
            } else {
                lastEntry.rate = rate;
            }

            if (this.rateHistory.length > 10) this.rateHistory.shift();
            localStorage.setItem('ar_rate_history', JSON.stringify(this.rateHistory));
            this.renderSparkline();
        }

        this.renderDashboard();

        if (this.currentClientId && this.currentViewId === 'client-profile-view') {
            this.renderClientProfile(this.currentClientId);
        }
    }

    setActiveCurrency(curr) {
        this.activeCurrency = curr;
        localStorage.setItem('ar_active_currency', curr);

        // Update UI
        document.querySelectorAll('#headerCurrencySwitch button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.curr === curr);
        });

        const rate = curr === 'USD' ? this.exchangeRate : this.exchangeRateEUR;
        document.getElementById('exchangeRateInput').value = rate.toFixed(2);
        document.getElementById('headerRateSymbol').textContent = curr === 'USD' ? '$' : '€';
        document.getElementById('rateLabel').textContent = `Tasa BCV (${curr})`;

        // Auto-fetch if rate is default 1.0
        if (rate === 1) {
            this.fetchBCVRate();
        }

        // Update Global Icons
        const iconClass = curr === 'EUR' ? 'ph ph-currency-eur' : 'ph ph-currency-dollar';
        document.getElementById('debtCardIcon').className = iconClass;
        document.getElementById('txAmountIcon').className = iconClass;

        this.renderDashboard();
        this.renderClientsTable(document.getElementById('globalSearchInput').value);

        if (this.currentClientId && this.currentViewId === 'client-profile-view') {
            this.renderClientProfile(this.currentClientId);
        }
    }

    setConverterMode(mode) {
        this.converterMode = mode;
        document.querySelectorAll('#converterCurrencyTabs button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        // Update labels and icons
        const symbol = mode === 'EUR' ? '€' : '$';
        const label = mode === 'EUR' ? 'Euros (€)' : 'Dólares ($)';
        const icon = mode === 'EUR' ? 'ph-currency-eur' : 'ph-currency-dollar';

        document.getElementById('convInputLabel').textContent = label;
        const iconEl = document.getElementById('convInputIcon');
        iconEl.className = `ph ${icon}`;

        const rate = mode === 'EUR' ? this.exchangeRateEUR : this.exchangeRate;
        document.getElementById('converterRateDisplay').textContent = `Tasa actual: 1${symbol} = ${rate.toFixed(2)} Bs.`;

        // If rate is default 1.0, try to fetch it
        if (rate === 1) {
            this.fetchBCVRate();
        }

        this.resetConverter();
    }

    updateHeaderUI() {
        document.querySelectorAll('#headerCurrencySwitch button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.curr === this.activeCurrency);
        });
        document.getElementById('headerRateSymbol').textContent = this.activeCurrency === 'USD' ? '$' : '€';
        document.getElementById('rateLabel').textContent = `Tasa BCV (${this.activeCurrency})`;

        const iconClass = this.activeCurrency === 'EUR' ? 'ph ph-currency-eur' : 'ph ph-currency-dollar';
        const debtCardIcon = document.getElementById('debtCardIcon');
        const txAmountIcon = document.getElementById('txAmountIcon');
        if (debtCardIcon) debtCardIcon.className = iconClass;
        if (txAmountIcon) txAmountIcon.className = iconClass;
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
        this.vibrate([20]);
        if (document.startViewTransition) {
            document.startViewTransition(() => {
                this._executeSwitchView(viewId);
            });
        } else {
            this._executeSwitchView(viewId);
        }
    }

    _executeSwitchView(viewId) {
        // Update Nav Active State
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
        const navBtn = document.querySelector(`.nav-item[data-target="${viewId}"]`);
        if (navBtn) navBtn.classList.add('active');

        // Toggle Sections
        const currentSection = document.getElementById(this.currentViewId);
        const targetSection = document.getElementById(viewId);

        if (currentSection && currentSection !== targetSection) {
            currentSection.classList.add('fade-out');
            setTimeout(() => {
                currentSection.classList.remove('active', 'fade-out');
                if (targetSection) {
                    targetSection.classList.add('active', 'fade-in');
                    setTimeout(() => targetSection.classList.remove('fade-in'), 300);
                }
            }, 300);
        } else if (targetSection) {
            targetSection.classList.add('active');
        }

        this.currentViewId = viewId;

        // Update Mobile Nav Active State
        document.querySelectorAll('.mobile-nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.target === viewId);
        });

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
            const rate = this.converterMode === 'EUR' ? this.exchangeRateEUR : this.exchangeRate;
            const symbol = this.converterMode === 'EUR' ? '€' : '$';
            document.getElementById('converterRateDisplay').textContent = `Tasa actual: 1${symbol} = ${rate.toFixed(2)} Bs.`;
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

        this.animateValue('totalClientsCount', 0, totalClients, 800);
        this.animateValue('totalDebtAmount', 0, totalSystemDebt, 1000, true);
        document.getElementById('totalDebtAmountVEF').textContent = this.formatVEF(totalSystemDebt);

        // This Month's collected amount
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const monthPayments = this.transactions
            .filter(t => t.type === 'PAYMENT' && t.createdAt >= startOfMonth)
            .reduce((acc, t) => acc + t.amount, 0);

        this.animateValue('totalMonthCollected', 0, monthPayments, 1000, true);
        document.getElementById('totalMonthCollectedVEF').textContent = this.formatVEF(monthPayments);

        this.renderDailyChart();
        this.renderCategoryChart();
        this.renderAgingReport();
        this.generateSmartInsights(totalSystemDebt, monthPayments);
    }

    generateSmartInsights(totalDebt, monthCollected) {
        const insightSection = document.getElementById('insightSection');
        const insightText = document.getElementById('insightText');
        if (!insightSection || !insightText) return;

        let insight = "";
        const moroseCount = this.clients.filter(c => this.isClientMorose(c.id)).length;

        if (moroseCount > 5) {
            insight = `Tienes ${moroseCount} clientes con más de un mes de retraso. Se recomienda enviar recordatorios por WhatsApp.`;
        } else if (totalDebt > 500 && monthCollected < totalDebt * 0.2) {
            insight = `La deuda global es alta (${this.formatCurrency(totalDebt)}). Considera ofrecer planes de pago para aumentar la liquidez.`;
        } else if (monthCollected > 0) {
            insight = `¡Buen trabajo! Has cobrado ${this.formatCurrency(monthCollected)} este mes. El flujo de caja está saludable.`;
        } else {
            insight = "Día tranquilo en cobranzas. Buen momento para revisar expedientes y organizar tu agenda.";
        }

        insightText.textContent = insight;
        insightSection.classList.remove('hidden');
    }

    renderCategoryChart() {
        const ctx = document.getElementById('categoryDebtChart').getContext('2d');
        const debtsByCategory = {};

        this.clients.forEach(c => {
            const cat = c.category || 'Sin Categoría';
            const balance = this.getClientBalance(c.id);
            if (balance > 0) {
                debtsByCategory[cat] = (debtsByCategory[cat] || 0) + balance;
            }
        });

        const labels = Object.keys(debtsByCategory);
        const data = Object.values(debtsByCategory);

        if (labels.length === 0) return;

        if (this.categoryDebtChart) this.categoryDebtChart.destroy();

        this.categoryDebtChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'
                    ],
                    borderWidth: 0,
                    hoverOffset: 15
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: this.theme === 'light' ? '#475569' : '#94a3b8',
                            font: { size: 11, family: 'Inter' },
                            padding: 20,
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                let label = context.label || '';
                                if (label) label += ': ';
                                label += this.formatCurrency(context.parsed);
                                return label;
                            }
                        }
                    }
                },
                cutout: '70%'
            }
        });
    }

    renderAgingReport() {
        const container = document.getElementById('agingReportContainer');
        if (!container) return;

        const now = Date.now();
        const DayMs = 24 * 60 * 60 * 1000;

        const buckets = [
            { label: '0-30 Días', min: 0, max: 30, amount: 0, count: 0, risk: 0 },
            { label: '31-60 Días', min: 31, max: 60, amount: 0, count: 0, risk: 1 },
            { label: '61-90 Días', min: 61, max: 90, amount: 0, count: 0, risk: 2 },
            { label: '+90 Días', min: 91, max: 9999, amount: 0, count: 0, risk: 3 }
        ];

        this.clients.forEach(client => {
            const balance = this.getClientBalance(client.id);
            if (balance <= 0) return;

            // Find oldest unpaid invoice (or just use last payment date logic)
            // For simplicity in this logic, we use the date of the first SALE that contributed to current debt
            const clientTxs = this.transactions
                .filter(t => String(t.clientId).toLowerCase() === String(client.uuid).toLowerCase())
                .sort((a, b) => a.createdAt - b.createdAt);

            const firstSale = clientTxs.find(t => t.type === 'SALE');
            if (!firstSale) return;

            const ageDays = Math.floor((now - firstSale.createdAt) / DayMs);

            const bucket = buckets.find(b => ageDays >= b.min && ageDays <= b.max) || buckets[buckets.length - 1];
            bucket.amount += balance;
            bucket.count++;
        });

        container.innerHTML = buckets.map(b => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <div style="width: 8px; height: 8px; border-radius: 50%; background: ${this.getRiskColor(b.risk)};"></div>
                    <span style="font-size: 0.85rem; color: var(--text-primary);">${b.label}</span>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 500; font-size: 0.85rem; color: var(--text-primary);">${this.formatCurrency(b.amount)}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">${b.count} clientes</div>
                </div>
            </div>
        `).join('');
    }

    getRiskColor(risk) {
        switch (risk) {
            case 0: return 'var(--accent-blue)';
            case 1: return '#f59e0b';
            case 2: return '#ef4444';
            case 3: return '#7f1d1d';
            default: return 'var(--text-muted)';
        }
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

        // Payment Methods Breakdown
        const pmBreakdownEl = document.getElementById('paymentMethodsBreakdown');
        pmBreakdownEl.innerHTML = '';

        let paymentBreakdown = {};
        for (let tx of filteredPayments) {
            let method = tx.payment_method || 'No Especificado';
            if (!paymentBreakdown[method]) paymentBreakdown[method] = 0;
            paymentBreakdown[method] += tx.amount;
        }

        const methodsSorted = Object.entries(paymentBreakdown).sort((a, b) => b[1] - a[1]);
        if (methodsSorted.length === 0) {
            pmBreakdownEl.innerHTML = '<p class="text-sm" style="color:var(--text-muted);">Sin abonos en este periodo.</p>';
        } else {
            for (let [method, amount] of methodsSorted) {
                pmBreakdownEl.innerHTML += `
                     <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0;">
                         <span style="font-size: 0.85rem; color: var(--text-primary);"><i class="ph ph-wallet"></i> ${this.escapeHTML(method)}</span>
                         <span style="font-weight: 500; font-size: 0.85rem; color: var(--accent-green);">${this.formatCurrency(amount)}</span>
                     </div>
                 `;
            }
        }

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
                        grid: { color: this.theme === 'light' ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: this.theme === 'light' ? '#475569' : '#94a3b8', font: { size: 10 } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: this.theme === 'light' ? '#475569' : '#94a3b8',
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

    vibrate(pattern = [50]) {
        if (navigator.vibrate) {
            try { navigator.vibrate(pattern); } catch (e) {}
        }
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
        const categoryFilter = document.getElementById('clientCategoryFilter')?.value || 'ALL';

        const filteredClients = this.clients.filter(c => {
            const matchesSearch = c.name.toLowerCase().includes(filter) ||
                                 (c.email && c.email.toLowerCase().includes(filter));
            
            const matchesCategory = categoryFilter === 'ALL' || (c.category === categoryFilter);

            return matchesSearch && matchesCategory;
        });

        const loadMoreBtn = document.getElementById('loadMoreClientsBtn');
        if (this.clients.length === 0) {
            document.querySelector('.data-table').classList.add('hidden');
            emptyState.classList.remove('hidden');
            if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
            return;
        } else {
            document.querySelector('.data-table').classList.remove('hidden');
            emptyState.classList.add('hidden');
        }

        if (filteredClients.length > this.clientsLimit) {
            if (loadMoreBtn) loadMoreBtn.classList.remove('hidden');
        } else {
            if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
        }

        const visibleClients = filteredClients.slice(0, this.clientsLimit);

        visibleClients.forEach(client => {
            const balance = this.getClientBalance(client.id);
            const totalSales = client.total_debt;
            const totalPayments = client.total_payments;

            const isMorose = this.isClientMorose(client.id);
            const tr = document.createElement('tr');

            tr.innerHTML = `
                <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div class="avatar" style="width:32px; height:32px; font-size:12px;">${this.escapeHTML(this.getInitials(client.name))}</div>
                        <div>
                            <span style="font-weight:500; display:block;">${this.escapeHTML(client.name)}</span>
                            ${isMorose ? `<span class="morose-alert"><i class="ph ph-warning"></i> +1 mes sin abono</span>` : ''}
                        </div>
                    </div>
                </td>
                <td>
                    <div style="font-size:0.85rem; color:var(--text-secondary)">
                        ${client.category ? `<span class="badge" style="background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; font-size:10px; margin-bottom:4px; display:inline-block;">${this.escapeHTML(client.category)}</span><br>` : ''}
                        ${client.phone ? `<i class="ph ph-phone"></i> ${this.escapeHTML(client.phone)}<br>` : ''}
                        ${client.email ? `<i class="ph ph-envelope"></i> ${this.escapeHTML(client.email)}` : ''}
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

        const confirm = await this.confirmAction('Eliminar Cliente', `¿Estás seguro de que deseas eliminar permanentemente a "${client.name}" y todo su historial de transacciones? Esta acción no se puede deshacer.`);
        if (!confirm) {
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

        const filterType = document.getElementById('profileTxFilterType').value;
        const filterDate = document.getElementById('profileTxFilterDate').value;
        const searchTerm = document.getElementById('profileTxSearch').value.toLowerCase();

        const clientUuid = String(client.uuid).toLowerCase();
        let clientTxs = (this.transactions || [])
            .filter(t => String(t.clientId).toLowerCase() === clientUuid);

        // Apply type filter
        if (filterType !== 'ALL') {
            clientTxs = clientTxs.filter(t => t.type === filterType);
        }

        // Apply search filter
        if (searchTerm) {
            clientTxs = clientTxs.filter(t => (t.description || '').toLowerCase().includes(searchTerm));
        }

        // Apply date filter
        if (filterDate !== 'ALL') {
            const now = new Date();
            let limitTimestamp = 0;
            if (filterDate === 'TODAY') {
                limitTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            } else if (filterDate === 'WEEK') {
                limitTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime();
            } else if (filterDate === 'MONTH') {
                limitTimestamp = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
            }
            clientTxs = clientTxs.filter(t => t.createdAt >= limitTimestamp);
        }

        clientTxs.sort((a, b) => b.createdAt - a.createdAt);

        // Update Filtered Total
        const totalFiltered = filterType === 'ALL' ? 0 : clientTxs.reduce((acc, tx) => acc + tx.amount, 0);
        const totalEl = document.getElementById('profileTxTotal');
        const totalValEl = document.getElementById('profileTxTotalValue');
        const totalVefEl = document.getElementById('profileTxTotalVEF');

        const isFiltered = filterType !== 'ALL' || filterDate !== 'ALL' || searchTerm;
        if (totalEl && totalValEl && totalVefEl) {
            // If ALL is selected, original requirement says total should be 0. 
            // We show the bar if there's any active filter, but with the value 0 if type is ALL.
            if (isFiltered && clientTxs.length > 0) {
                totalEl.classList.remove('hidden');
                totalValEl.textContent = this.formatCurrency(totalFiltered);
                totalVefEl.textContent = `(${this.formatVEF(totalFiltered)})`;
            } else {
                totalEl.classList.add('hidden');
            }
        }

        if (clientTxs.length === 0) {
            emptyState.classList.remove('hidden');
        } else {
            emptyState.classList.add('hidden');
            clientTxs.forEach(tx => {
                const isSale = tx.type === 'SALE';
                const el = document.createElement('div');
                el.className = `tx-item ${isSale ? 'sale' : 'payment'}`;

                let displayDesc = tx.description || (isSale ? 'Venta' : 'Abono');
                let historicalRate = this.exchangeRate;
                if (displayDesc.includes('| Tasa:')) {
                    const parts = displayDesc.split('| Tasa:');
                    displayDesc = parts[0].trim();
                    historicalRate = parseFloat(parts[1].trim()) || historicalRate;
                }
                const txVefVal = tx.amount * historicalRate;
                const formattedVef = new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'VES' }).format(txVefVal);

                el.innerHTML = `
                    <div class="tx-info">
                        <h4>${this.escapeHTML(displayDesc)}</h4>
                        <span>${this.formatDate(tx.createdAt)} • ${isSale ? 'Venta (Deuda)' : 'Abono'}</span>
                    </div>
                    <div class="tx-actions">
                        <div class="tx-amount ${isSale ? 'text-danger' : 'text-success'}" style="text-align: right;">
                            <div>${isSale ? '+' : '-'}${this.formatCurrency(tx.amount)}</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 400;">${formattedVef}</div>
                        </div>
                        <button class="icon-btn-sm" onclick="app.openEditTransactionModal('${tx.id}')" title="Editar Transacción">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="icon-btn-sm" onclick="app.deleteTransaction('${tx.id}')" title="Eliminar Transacción" style="color: var(--accent-red);">
                            <i class="ph ph-trash"></i>
                        </button>
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

        // Update Filtered Total (Global)
        const totalFiltered = typeFilter === 'ALL' ? 0 : allTxs.reduce((acc, tx) => acc + tx.amount, 0);
        const totalEl = document.getElementById('globalTxTotal');
        const totalValEl = document.getElementById('globalTxTotalValue');
        const totalVefEl = document.getElementById('globalTxTotalVEF');

        const isFiltered = typeFilter !== 'ALL' || dateFilter !== 'ALL';
        if (totalEl && totalValEl && totalVefEl) {
            if (isFiltered && allTxs.length > 0) {
                totalEl.classList.remove('hidden');
                totalValEl.textContent = this.formatCurrency(totalFiltered);
                totalVefEl.textContent = `(${this.formatVEF(totalFiltered)})`;
            } else {
                totalEl.classList.add('hidden');
            }
        }

        const loadMoreBtn = document.getElementById('loadMoreTxBtn');
        if (allTxs.length === 0) {
            emptyState.classList.remove('hidden');
            if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
        } else {
            emptyState.classList.add('hidden');

            if (allTxs.length > this.txLimit) {
                if (loadMoreBtn) loadMoreBtn.classList.remove('hidden');
            } else {
                if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
            }
            const visibleTxs = allTxs.slice(0, this.txLimit);

            visibleTxs.forEach(tx => {
                const clientUuid = String(tx.clientId).toLowerCase();
                const client = this.clients.find(c => String(c.uuid).toLowerCase() === clientUuid || String(c.id).toLowerCase() === clientUuid);
                const clientName = client ? client.name : 'Cliente Eliminado/Desconocido';

                const isSale = tx.type === 'SALE';
                const el = document.createElement('div');
                el.className = `tx-item ${isSale ? 'sale' : 'payment'}`;

                let displayDesc = tx.description || (isSale ? 'Venta' : 'Abono');
                let historicalRate = this.exchangeRate;
                if (displayDesc.includes('| Tasa:')) {
                    const parts = displayDesc.split('| Tasa:');
                    displayDesc = parts[0].trim();
                    historicalRate = parseFloat(parts[1].trim()) || historicalRate;
                }
                const txVefVal = tx.amount * historicalRate;
                const formattedVef = new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'VES' }).format(txVefVal);

                el.innerHTML = `
                    <div class="tx-info">
                        <h4>${this.escapeHTML(displayDesc)}</h4>
                        <span>${this.formatDate(tx.createdAt)} • ${isSale ? 'Venta (Deuda)' : 'Abono'} • <strong>${this.escapeHTML(clientName)}</strong></span>
                    </div>
                    <div class="tx-actions">
                        <div class="tx-amount ${isSale ? 'text-danger' : 'text-success'}" style="text-align: right;">
                            <div>${isSale ? '+' : '-'}${this.formatCurrency(tx.amount)}</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 400;">${formattedVef}</div>
                        </div>
                        <button class="icon-btn-sm" onclick="app.openEditTransactionModal('${tx.id}')" title="Editar Transacción">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="icon-btn-sm" onclick="app.deleteTransaction('${tx.id}')" title="Eliminar Transacción" style="color: var(--accent-red);">
                            <i class="ph ph-trash"></i>
                        </button>
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
        document.getElementById('txId').value = '';
        const title = type === 'SALE' ? 'Registrar Nueva Venta (Aumento de Deuda)' : 'Registrar Abono (Reducción de Deuda)';
        document.getElementById('txModalTitle').textContent = title;
        document.getElementById('transactionForm').reset();

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        document.getElementById('txDate').value = `${year}-${month}-${day}T${hours}:${minutes}`;

        // Payment Method toggle
        const pmGroup = document.getElementById('txPaymentMethodGroup');
        if (type === 'SALE') {
            pmGroup.style.display = 'none';
        } else {
            pmGroup.style.display = 'block';
        }

        const modal = document.getElementById('transactionModal');
        const addAnotherBtn = document.getElementById('txSubmitAndAddAnotherBtn');
        if (addAnotherBtn) addAnotherBtn.style.display = 'block';

        const itemsSection = document.getElementById('txItemsSection');
        if (itemsSection) {
            itemsSection.style.display = type === 'SALE' ? 'block' : 'none';
            // Clear subtotal values in rows
            document.querySelectorAll('.item-subtotal').forEach(s => s.textContent = '$0.00');
        }

        modal.classList.remove('hidden');
        // Let reflow happen for animation
        setTimeout(() => modal.classList.add('active'), 10);
    }

    closeTransactionModal() {
        const modal = document.getElementById('transactionModal');
        modal.classList.remove('active');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }

    async deleteTransaction(txId) {
        const confirm = await this.confirmAction('Eliminar Transacción', '¿Estás seguro de que deseas eliminar esta transacción? Esta acción afectará el saldo del cliente y no se puede deshacer.');
        if (!confirm) return;

        try {
            const { error } = await this.supabase.from('transactions').delete().eq('id', txId).eq('user_id', this.user.id);
            if (error) {
                const { error: error2 } = await this.supabase.from('transactions').delete().eq('local_id', txId).eq('user_id', this.user.id);
                if (error2) throw error2;
            }

            this.showToast('Transacción eliminada con éxito');
            await this.saveData();
        } catch (err) {
            console.error("Delete Tx Error:", err);
            this.showToast('Error al eliminar transacción', 'error');
        }
    }

    openEditTransactionModal(txId) {
        const tx = this.transactions.find(t => String(t.id) === String(txId) || String(t.local_id) === String(txId));
        if (!tx) return;

        this.openTransactionModal(tx.type);
        document.getElementById('txId').value = tx.local_id || tx.id;
        document.getElementById('txModalTitle').textContent = tx.type === 'SALE' ? 'Editar Venta' : 'Editar Abono';
        document.getElementById('txAmount').value = tx.amount;

        let displayDesc = tx.description || '';
        if (displayDesc.includes('| Tasa:')) {
            displayDesc = displayDesc.split('| Tasa:')[0].trim();
        }
        document.getElementById('txDescription').value = displayDesc;

        // Date handling
        const d = new Date(tx.createdAt);
        const dateStr = d.toISOString().slice(0, 16);
        document.getElementById('txDate').value = dateStr;

        if (tx.type === 'PAYMENT' && tx.payment_method) {
            document.getElementById('txPaymentMethod').value = tx.payment_method;
        }

        // Hide "Add Another" button when editing
        const addAnotherBtn = document.getElementById('txSubmitAndAddAnotherBtn');
        if (addAnotherBtn) addAnotherBtn.style.display = 'none';
    }
    sendWhatsApp() {
        const client = this.getClient(this.currentClientId);
        if (!client) return;

        const balance = this.getClientBalance(client.id);
        if (balance <= 0) {
            this.showToast('El cliente no tiene deudas pendientes.', 'info');
            return;
        }

        const phone = client.phone ? client.phone.replace(/\D/g, '') : '';
        if (!phone) {
            this.showToast('El cliente no tiene teléfono.', 'error');
            this.vibrate([200]);
            return;
        }

        const formattedBalance = this.formatCurrency(balance);
        
        const message = `Hola ${client.name}, te escribimos de *Inversiones Morey*. Tienes un saldo pendiente de *${formattedBalance}*. Por favor, contáctanos para procesar tu pago. ¡Gracias!`;
        
        const url = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
        this.vibrate([50, 50, 100]);
    }

    generatePDF(txId) {
        const tx = this.transactions.find(t => t.id === txId);
        if (!tx) return;
        
        const client = this.getClient(tx.clientId) || { name: 'Desconocido', email: '', phone: '' };
        const amountFormatted = this.formatCurrency(tx.amount);
        const typeStr = tx.type === 'SALE' ? 'Recibo de Venta' : 'Recibo de Abono';
        const dateStr = this.formatDate(tx.createdAt);

        let parts = (tx.description || '').split('| Tasa:');
        let desc = parts[0].trim();
        let tasa = parts[1] ? parts[1].trim() : 'N/A';

        const pdfContainer = document.createElement('div');
        pdfContainer.style.padding = '40px';
        pdfContainer.style.background = '#ffffff';
        pdfContainer.style.color = '#000000';
        pdfContainer.style.fontFamily = "'Inter', sans-serif";
        pdfContainer.style.width = '210mm';
        pdfContainer.style.height = '297mm';
        
        pdfContainer.innerHTML = `
            <div style="text-align: center; margin-bottom: 40px;">
                <h1 style="color: #3b82f6; font-size: 36px; margin: 0;">Inversiones Morey</h1>
                <p style="color: #64748b; font-size: 16px; margin-top: 5px;">Comprobante de Transacción</p>
            </div>
            
            <div style="display: flex; justify-content: space-between; margin-bottom: 40px; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px;">
                <div>
                    <h3 style="color: #1e293b; margin: 0 0 10px 0; font-size: 20px;">Detalles del Cliente</h3>
                    <p style="margin: 5px 0;"><strong>Nombre:</strong> ${this.escapeHTML(client.name)}</p>
                    ${client.email ? `<p style="margin: 5px 0;"><strong>Email:</strong> ${this.escapeHTML(client.email)}</p>` : ''}
                    ${client.phone ? `<p style="margin: 5px 0;"><strong>Teléfono:</strong> ${this.escapeHTML(client.phone)}</p>` : ''}
                </div>
                <div style="text-align: right;">
                    <h3 style="color: #1e293b; margin: 0 0 10px 0; font-size: 20px;">Información del Recibo</h3>
                    <p style="margin: 5px 0;"><strong>Fecha:</strong> ${dateStr}</p>
                    <p style="margin: 5px 0;"><strong>Tipo:</strong> ${typeStr}</p>
                    ${tx.type === 'PAYMENT' && tx.payment_method ? `<p style="margin: 5px 0;"><strong>Método de Pago:</strong> ${this.escapeHTML(tx.payment_method)}</p>` : ''}
                    <p style="margin: 5px 0;"><strong>Ref:</strong> #${tx.local_id ? tx.local_id.substring(0, 8).toUpperCase() : 'N/A'}</p>
                </div>
            </div>

            <div style="margin-bottom: 40px;">
                 <h3 style="color: #1e293b; margin: 0 0 15px 0; font-size: 20px;">Concepto</h3>
                 <div style="background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.2); padding: 20px; border-radius: 8px;">
                     <p style="font-size: 18px; margin: 0; line-height: 1.5;">${this.escapeHTML(desc)}</p>
                 </div>
            </div>

            <div style="display: flex; justify-content: flex-end; margin-bottom: 50px;">
                <div style="width: 300px;">
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding: 10px 0;">
                        <span style="font-weight: bold; color: #64748b;">Tasa BCV Aplicada:</span>
                        <span>${this.escapeHTML(tasa)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 15px 0;">
                        <span style="font-size: 24px; font-weight: bold; color: #1e293b;">Total:</span>
                        <span style="font-size: 24px; font-weight: bold; color: #3b82f6;">${amountFormatted}</span>
                    </div>
                </div>
            </div>
            
            <div style="text-align: center; color: #94a3b8; font-size: 14px; position: absolute; bottom: 50px; width: calc(100% - 80px);">
                <p>Gracias por preferir a Inversiones Morey.</p>
                <p style="font-size: 12px; margin-top: 10px;">Documento generado el ${new Date().toLocaleString()}</p>
            </div>
        `;
        
        const opt = {
            margin:       0,
            filename:     `Recibo_${client.name.replace(/\s+/g,'_')}_${new Date().getTime()}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
        };

        this.showToast('Generando recibo...', 'info');
        this.vibrate([50]);
        html2pdf().set(opt).from(pdfContainer).save().then(() => {
            this.showToast('Recibo PDF descargado exitosamente', 'success');
            this.vibrate([100, 50, 100]);
        });
    }

    async handleTransactionSubmit(submitterBtn) {
        const txId = document.getElementById('txId').value;
        const type = document.getElementById('txType').value;
        const amount = parseFloat(document.getElementById('txAmount').value);
        const description = document.getElementById('txDescription').value;
        const formDateVal = document.getElementById('txDate').value;
        const txDate = formDateVal ? new Date(formDateVal) : new Date();
        const paymentMethod = type === 'SALE' ? null : document.getElementById('txPaymentMethod').value;

        if (!amount || amount <= 0) {
            this.showToast('El monto debe ser mayor a 0', 'error');
            this.vibrate([200]);
            return;
        }
        if (!description.trim()) {
            this.showToast('La descripción es obligatoria', 'error');
            this.vibrate([200]);
            return;
        }
        if (txDate > new Date()) {
            this.showToast('La fecha no puede ser en el futuro', 'error');
            this.vibrate([200]);
            return;
        }

        const dbClient = this.clients.find(c => c.id === this.currentClientId);
        if (!dbClient) {
            this.showToast('Error: Cliente no encontrado', 'error');
            return;
        }

        const activeRate = this.activeCurrency === 'USD' ? this.exchangeRate : this.exchangeRateEUR;
        let descriptionToSave = document.getElementById('txDescription').value.trim();

        // If it's a SALE, check for detailed items
        if (type === 'SALE') {
            const items = [];
            const itemsContainer = document.getElementById('txItemsContainer');
            if (itemsContainer) {
                itemsContainer.querySelectorAll('.item-row').forEach(row => {
                    const desc = row.querySelector('.item-desc').value.trim();
                    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
                    const price = parseFloat(row.querySelector('.item-price').value) || 0;
                    if (desc && qty > 0) {
                        items.push(`${qty}x ${desc} ($${price.toFixed(2)})`);
                    }
                });
            }
            if (items.length > 0) {
                descriptionToSave += ' (' + items.join(', ') + ')';
            }
        }

        if (!descriptionToSave.includes('| Tasa:')) {
            descriptionToSave += ' | Tasa: ' + activeRate;
        }

        const payload = {
            client_id: dbClient.uuid,
            type,
            amount,
            description: descriptionToSave,
            payment_method: paymentMethod,
            created_at: txDate.toISOString(),
            user_id: this.user.id
        };

        try {
            if (txId) {
                // Update
                const { error } = await this.supabase.from('transactions').update(payload).eq('local_id', txId).eq('user_id', this.user.id);
                if (error) {
                    const { error: error2 } = await this.supabase.from('transactions').update(payload).eq('id', txId).eq('user_id', this.user.id);
                    if (error2) throw error2;
                }
                this.showToast('Transacción actualizada');
                this.vibrate([50]);
            } else {
                // Insert
                payload.local_id = this.getUniqueId();
                const { error } = await this.supabase.from('transactions').insert(payload);
                if (error) throw error;
                this.showToast(type === 'SALE' ? 'Venta registrada' : 'Abono registrado');
                this.vibrate([100]);
            }

            await this.saveData();

            // Confetti if balance is zero after a payment
            if (type === 'PAYMENT') {
                const newBalance = this.getClientBalance(this.currentClientId);
                if (newBalance <= 0) {
                    this.triggerConfetti();
                }
            }

            if (submitterBtn && submitterBtn.id === 'txSubmitAndAddAnotherBtn') {
                // Keep modal open, clear fields
                document.getElementById('txId').value = '';
                document.getElementById('txAmount').value = '';
                document.getElementById('txDescription').value = '';
                document.getElementById('txAmount').focus();
            } else {
                this.closeTransactionModal();
            }

        } catch (error) {
            console.error("Tx Submit Error:", error);
            this.showToast('Error al procesar la transacción', 'error');
        }
    }

    triggerConfetti() {
        const duration = 3 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

        const randomInRange = (min, max) => Math.random() * (max - min) + min;

        const interval = setInterval(() => {
            const timeLeft = animationEnd - Date.now();

            if (timeLeft <= 0) {
                return clearInterval(interval);
            }

            const particleCount = 50 * (timeLeft / duration);
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
        }, 250);
    }



    exportToCSV() {
        if (!this.clients || this.clients.length === 0) {
            this.showToast('No hay clientes para exportar', 'warning');
            return;
        }

        // CSV Header
        const headers = ['Nombre', 'Teléfono', 'Categoría', 'Ventas Acumuladas ($)', 'Abonos Acumulados ($)', 'Saldo Pendiente ($)'];
        let csvContent = headers.join(',') + '\n';

        // CSV Rows
        this.clients.forEach(client => {
            const balance = this.getClientBalance(client.id);
            const totalSales = client.total_debt;
            const totalPayments = totalSales - balance;

            // Escape fields for CSV if they use commas
            const name = `"${client.name.replace(/"/g, '""')}"`;
            const phone = `"${(client.phone || '').replace(/"/g, '""')}"`;
            const category = `"${(client.category || '').replace(/"/g, '""')}"`;

            const row = [
                name,
                phone,
                category,
                totalSales.toFixed(2),
                totalPayments.toFixed(2),
                balance.toFixed(2)
            ];

            csvContent += row.join(',') + '\n';
        });

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.setAttribute('href', url);
        a.setAttribute('download', `Clientes_Morey_${new Date().toISOString().split('T')[0]}.csv`);
        a.style.visibility = 'hidden';
        document.body.appendChild(a);

        a.click();

        document.body.removeChild(a);
        this.showToast('Archivo CSV exportado con éxito');
    }
}

// Initialize App
const app = new AccountsApp();
window.app = app; // Expose globally for inline onclick handlers
