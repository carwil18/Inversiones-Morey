import { formatCurrency, formatVEF } from './utils.js';

/**
 * Analyzes app data to generate smart insights
 * @param {Array} clients 
 * @param {Array} transactions 
 * @param {number} exchangeRate 
 * @param {string} activeCurrency 
 * @returns {string} 
 */
export function generateSmartInsights(clients, transactions, exchangeRate, activeCurrency) {
    if (!clients || clients.length === 0) return "¡Hola! Registra tu primer cliente para comenzar el análisis.";

    const totalDebt = clients.reduce((acc, c) => acc + (c.total_debt - c.total_payments), 0);
    const moroseClients = clients.filter(c => (c.total_debt - c.total_payments) > 0);
    
    // 1. Critical Debt insight
    if (moroseClients.length > 0) {
        const topDebtor = moroseClients.reduce((prev, current) => 
            ((current.total_debt - current.total_payments) > (prev.total_debt - prev.total_payments)) ? current : prev
        );
        const debtValue = topDebtor.total_debt - topDebtor.total_payments;
        if (debtValue > 100) {
            return `💡 <strong>${topDebtor.name}</strong> tiene la deuda más alta: <strong>${formatCurrency(debtValue, activeCurrency)}</strong>. Considera enviarle un recordatorio.`;
        }
    }

    // 2. Collection trend (last 30 days vs previous 30 days)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30)).getTime();
    const sixtyDaysAgo = new Date(now.setDate(now.getDate() - 30)).getTime();

    const currentMonthPayments = transactions.filter(t => t.type === 'PAYMENT' && t.createdAt >= thirtyDaysAgo);
    const lastMonthPayments = transactions.filter(t => t.type === 'PAYMENT' && t.createdAt < thirtyDaysAgo && t.createdAt >= sixtyDaysAgo);

    const currentTotal = currentMonthPayments.reduce((acc, t) => acc + t.amount, 0);
    const lastTotal = lastMonthPayments.reduce((acc, t) => acc + t.amount, 0);

    if (currentTotal > lastTotal && lastTotal > 0) {
        const percent = Math.round(((currentTotal - lastTotal) / lastTotal) * 100);
        return `📈 ¡Excelente ritmo! Has cobrado un <strong>${percent}% más</strong> este mes comparado con el anterior.`;
    }

    // 3. Payment Methods insight
    const methods = {};
    transactions.filter(t => t.type === 'PAYMENT').forEach(t => {
        methods[t.payment_method] = (methods[t.payment_method] || 0) + 1;
    });

    const topMethod = Object.entries(methods).sort((a,b) => b[1] - a[1])[0];
    if (topMethod) {
        return `💳 El método de pago más usado por tus clientes es <strong>${topMethod[0]}</strong>. Úsalo a tu favor.`;
    }

    // 4. Aging insight
    const oldDebts = transactions.filter(t => t.type === 'SALE' && (Date.now() - t.createdAt) > (1000 * 60 * 60 * 24 * 30));
    if (oldDebts.length > 5) {
        return `⚠️ Tienes varias deudas con más de <strong>30 días de antigüedad</strong>. Es un buen momento para una cobranza masiva.`;
    }

    return "✅ Todo al día. Mantén el buen ritmo de cobranzas.";
}
