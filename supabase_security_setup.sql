-- ============================================================
-- INVERSIONES MOREY: SQL Security & Performance Setup
-- Ejecuta este script en el "SQL Editor" de tu panel de Supabase
-- ============================================================

-- 1. Habilitar RLS (Row Level Security) en todas las tablas
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.margin_products ENABLE ROW LEVEL SECURITY;

-- 2. Asegurar columnas user_id con DEFAULT auth.uid()
ALTER TABLE public.clients 
    ALTER COLUMN user_id SET DEFAULT auth.uid();

ALTER TABLE public.transactions 
    ALTER COLUMN user_id SET DEFAULT auth.uid();

-- 3. Índices de rendimiento (Acelera búsquedas y filtrados de cada usuario)
CREATE INDEX IF NOT EXISTS idx_clients_user_id 
    ON public.clients (user_id);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id 
    ON public.transactions (user_id);

CREATE INDEX IF NOT EXISTS idx_transactions_client_id 
    ON public.transactions (client_id);

CREATE INDEX IF NOT EXISTS idx_transactions_created_at 
    ON public.transactions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_margin_products_user_id 
    ON public.margin_products (user_id);

CREATE INDEX IF NOT EXISTS idx_margin_products_created_at 
    ON public.margin_products (created_at DESC);

-- 4. Políticas para la tabla "clients"
DROP POLICY IF EXISTS "Users can manage their own clients" ON public.clients;
CREATE POLICY "Users can manage their own clients" 
ON public.clients 
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 5. Políticas para la tabla "transactions"
DROP POLICY IF EXISTS "Users can manage their own transactions" ON public.transactions;
CREATE POLICY "Users can manage their own transactions" 
ON public.transactions 
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 6. Políticas para la tabla "margin_products"
DROP POLICY IF EXISTS "Users can manage their own margin products" ON public.margin_products;
CREATE POLICY "Users can manage their own margin products"
ON public.margin_products
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- NOTA RECOMENDADA PARA INTEGRIDAD DE DATOS:
-- Si deseas que al eliminar un cliente se borren automáticamente sus transacciones huérfanas:
-- ALTER TABLE public.transactions
--     DROP CONSTRAINT IF EXISTS fk_transactions_client,
--     ADD CONSTRAINT fk_transactions_client 
--     FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
