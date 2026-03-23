import { supabase } from './api.js';

export async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

export async function signUp(email, password, origin) {
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            emailRedirectTo: origin
        }
    });
    if (error) throw error;
    return data;
}

export async function resetPassword(email, origin) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: origin
    });
    if (error) throw error;
}

export async function logout() {
    await supabase.auth.signOut();
}

export async function getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
}
