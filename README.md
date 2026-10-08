# DFS LEAGUE S2

Web del torneo de Free Fire (LATAM · solo móvil). Sitio estático pensado para GitHub Pages.

- `index.html` — web pública (info, calendario, resultados, comunidad, sponsors).
- `admin.html` — panel de administración.
- `data.json` — todo el contenido del torneo. La web lo lee al cargar.

## Base de datos (Supabase)

Resultados, calendario, sponsors, ajustes y usuarios viven en Supabase. Si `assets/config.js` no tiene clave, la web usa `data.json` como respaldo.

Configuración (una sola vez):

1. Supabase → **SQL Editor** → pega y ejecuta [`supabase/schema.sql`](supabase/schema.sql).
2. Supabase → **Project Settings → API Keys** → copia la clave **anon / publishable** en `assets/config.js`.
   ⚠️ Nunca uses la `service_role` en la web: da control total de la base de datos.
3. Abre `/admin.html` → **Crear cuenta** → confirma el correo.
4. En el SQL Editor conviértete en admin:
   `update public.profiles set role = 'admin' where email = 'tu-correo';`

## Panel admin

- Inicia sesión en `/admin.html`. Las cuentas nuevas quedan **pendiente**; un admin les da rol en **Usuarios**
  (**editor**: edita contenido · **admin**: también gestiona usuarios).
- Edita general, Instagram y grupo, premios, calendario, resultados y los 18 sponsors y pulsa **Guardar cambios**:
  se ve en la web al instante. Los logos y el póster se suben al bucket `media`.
- En Resultados, “Pegar lista” acepta una línea por equipo: `Equipo, Booyah, Kills, Pts posición`
  (también sirve copiar columnas desde Excel/Sheets).

## Probar en local

```bash
python -m http.server 5173
```

Luego abre http://localhost:5173 (abrir el HTML con doble clic no funciona porque el navegador bloquea la carga de `data.json`).
