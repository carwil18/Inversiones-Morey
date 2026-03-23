import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Initialize supabase (assuming the library is loaded via CDN globally for now, 
// or I can import it if I switch to a full module system). 
// Since index.html has the CDN script, 'supabase' should be globally available.
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

export const supabase = _supabase;

export async function fetchClients(userId) {
    const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('user_id', userId);
    if (error) throw error;
    return data;
}

export async function fetchTransactions(userId) {
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId);
    if (error) throw error;
    return data;
}

export async function upsertClient(clientData) {
    const { data, error } = await supabase
        .from('clients')
        .upsert(clientData)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function insertTransaction(txData) {
    const { data, error } = await supabase
        .from('transactions')
        .insert(txData)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function deleteClient(id) {
    const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

export async function deleteTransaction(txId) {
    const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('id', txId);
    if (error) throw error;
}

export async function updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
}
