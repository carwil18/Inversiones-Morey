-- INVERSIONES MOREY: SQL Security Setup
-- Ejecuta este script en el "SQL Editor" de tu panel de Supabase para asegurar tus datos.

-- 1. Habilitar RLS (Row Level Security) en las tablas
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- 2. Políticas para la tabla "clients"
-- Permite a los usuarios gestionar solo sus propios clientes
CREATE POLICY "Users can manage their own clients" 
ON public.clients 
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 3. Políticas para la tabla "transactions"
-- Permite a los usuarios gestionar solo sus propias transacciones
CREATE POLICY "Users can manage their own transactions" 
ON public.transactions 
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 4. Protección adicional: Forzar que el user_id sea el del usuario autenticado
-- Esto evita que alguien intente guardar datos a nombre de otro usuario
ALTER TABLE public.clients 
ALTER COLUMN user_id SET DEFAULT auth.uid();

ALTER TABLE public.transactions 
ALTER COLUMN user_id SET DEFAULT auth.uid();

-- NOTA: Asegúrate de que las columnas 'user_id' existen y son de tipo 'uuid'.
-- Si no existen, puedes crearlas con:
-- ALTER TABLE clients ADD COLUMN IF NOT EXISTS user_id uuid references auth.users not null;
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id uuid references auth.users not null;

-- ============================================================
-- TABLA: margin_products (Calculadora de Margen de Ganancia)
-- Ejecuta este bloque en el SQL Editor de Supabase
-- ============================================================

-- 1. Crear tabla
CREATE TABLE IF NOT EXISTS public.margin_products (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL DEFAULT auth.uid(),
    name        text NOT NULL,
    cost        numeric(12, 4) NOT NULL,
    margin      numeric(6, 4) NOT NULL,
    profit      numeric(12, 4) NOT NULL,
    sale_price  numeric(12, 4) NOT NULL,
    created_at  timestamptz DEFAULT now() NOT NULL
);

-- 2. Habilitar Row Level Security
ALTER TABLE public.margin_products ENABLE ROW LEVEL SECURITY;

-- 3. Política: cada usuario solo ve y gestiona sus propios productos
CREATE POLICY "Users can manage their own margin products"
ON public.margin_products
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
