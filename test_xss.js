
// Script de prueba para verificar la protección XSS (escapeHTML)
const dangerousPayload = "<img src=x onerror=alert('XSS_SUCCESSFUL')>";

function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    // Simulación de lo que hace el navegador con div.textContent
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

const result = escapeHTML(dangerousPayload);

console.log("=== PRUEBA DE SEGURIDAD XSS ===");
console.log("Carga peligrosa original:", dangerousPayload);
console.log("Carga después de escapeHTML:", result);

if (result.includes("<") || result.includes(">")) {
    console.log("RESULTADO: [FALHA] - El script aún contiene caracteres peligrosos.");
} else {
    console.log("RESULTADO: [ÉXITO] - Los caracteres peligrosos han sido neutralizados.");
    console.log("Explicación: El navegador mostrará el código como texto literal en lugar de ejecutarlo.");
}
