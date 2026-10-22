# Cuentas y pago: pasos para activarlo

La pantalla de registro ya está en la app, pero **está apagada** hasta que hagas estos pasos y me pases dos datos. Mientras tanto, la app funciona como siempre.

## 1. Crear el servicio de cuentas (Supabase, gratis)
1. Entrá a **supabase.com** y creá una cuenta gratis (podés entrar con GitHub).
2. Tocá **New project**. Ponele un nombre (por ejemplo, *ruta-escaner*), una contraseña de base de datos (guardala) y la región **South America (São Paulo)**.
3. Cuando termine de crearse, abrí **SQL Editor**, pegá todo el contenido de `supabase.sql` y tocá **Run**.
4. (Recomendado) En **Authentication > Sign In / Providers > Email**, apagá **Confirm email**. Así la cuenta queda creada al toque, sin tener que confirmar un mail.
5. En **Project Settings > API**, copiá:
   - **Project URL** (algo como `https://xxxx.supabase.co`)
   - la clave **anon public**

   Esta clave está hecha para ser pública: va dentro de la app y me la podés pasar por acá. **No** me pases la clave *service_role* ni la contraseña de la base de datos.

## 1b. Lectura con tu clave de Gemini para todos (servidor)
Así ningún repartidor tiene que cargar una clave: la app le pide la lectura a tu Supabase, y Supabase usa tu clave sin que nadie la vea. Solo funciona para cuentas activas.
1. En Supabase, abrí **Edge Functions** y tocá **Deploy a new function > Via Editor**.
2. Nombre: **leer-etiqueta** (exacto, en minúsculas).
3. Borrá el código de ejemplo y pegá todo el contenido de `supabase/functions/leer-etiqueta/index.ts` (está en el repositorio y en esta carpeta). Tocá **Deploy**.
4. En **Edge Functions > Secrets**, agregá uno nuevo:
   - Name: **GEMINI_API_KEY**
   - Value: tu clave de Google AI Studio.

   Esta clave **no** me la pases por acá: la pegás vos ahí.
5. (Recomendado) En Google AI Studio activá la facturación de esa clave: en el plan gratis hay un límite de lecturas por día para todos juntos, y Google puede usar las fotos de las etiquetas.

Si un repartidor carga su propia clave en Ajustes, la app usa la de él en vez de la tuya.

## 2. Crear el link de pago (Mercado Pago)
1. En la app o la web de Mercado Pago, buscá **Cobrar > Link de pago**.
2. Poné el precio y una descripción (por ejemplo, *Ruta Escáner, 1 mes*) y crealo.
3. Copiá el link y pasámelo.

## 3. Cuando esté activado
- Entrá a la app, tocá **Crear cuenta** y registrate vos primero.
- Activá tu cuenta: en Supabase, **Table Editor > perfiles**, poné **activo** en `true` en tu fila.
- Cada vez que alguien te pague, hacé lo mismo con su fila (buscalo por el correo).
- Para cortarle el acceso a alguien, poné **activo** en `false`.

## A tener en cuenta
- La activación es manual: la app no se entera sola de que alguien pagó.
- La app es una página pública, así que alguien que sepa programar podría saltarse la pantalla de ingreso. Para un cobro serio hace falta un servidor; se puede sumar después.
