export function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export function formatCurrency(amount, activeCurrency = 'USD') {
    const currCode = activeCurrency === 'EUR' ? 'EUR' : 'USD';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currCode }).format(amount);
}

export function formatVEF(amount, exchangeRate, activeCurrency = 'USD') {
    const vefAmount = amount * exchangeRate;
    return 'Bs. ' + new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(vefAmount);
}

export function formatDate(timestamp) {
    return new Intl.DateTimeFormat('es-DO', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    }).format(new Date(timestamp));
}

export function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

export function animateValue(id, start, end, duration, isCurrency = false, appInstance = null) {
    const obj = document.getElementById(id);
    if (!obj) return;
    
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const current = progress * (end - start) + start;
        
        if (isCurrency && appInstance) {
            obj.textContent = appInstance.formatCurrency(current);
        } else {
            obj.textContent = Math.floor(current);
        }

        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

export function getUniqueId() {
    return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}
