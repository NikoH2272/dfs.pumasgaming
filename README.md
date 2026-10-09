# DFS LEAGUE S2

Web del torneo de Free Fire (LATAM · solo móvil). Sitio estático pensado para GitHub Pages.

- `index.html` — web pública (info, calendario, resultados, comunidad, sponsors).
- `admin.html` — panel de administración.
- `data.json` — todo el contenido del torneo. La web lo lee al cargar.

## Base de datos (Supabase)

Resultados, calendario, sponsors, ajustes y usuarios viven en Supabase. Si `assets/config.js` no tiene clave, la web usa `data.json` como respaldo.

Configuración (una sola vez):

1. Supabase → **SQL Editor** → pega y ejecuta [`supabase/schema.sql`](supabase/schema.sql) (se puede repetir sin perder datos).
2. Crea tu usuario admin ejecutando en el SQL Editor (cambia usuario y clave):
   `select public.staff_set_admin('tu_usuario', 'tu_clave');`
   La misma línea sirve para recuperar la clave si la olvidas.
3. Supabase → **Project Settings → API Keys** → copia la clave **anon / publishable** en `assets/config.js`.
   ⚠️ Nunca uses la `service_role` en la web: da control total de la base de datos.

Los usuarios del staff viven en la tabla `staff_users` (usuario + clave cifrada con bcrypt, sin correo).
La web solo lee; todo lo que escribe el admin pasa por funciones `staff_*` que validan la sesión.

## Panel admin

- Inicia sesión en `/admin.html` con usuario y clave. En **Usuarios** el admin crea cuentas, cambia roles,
  restablece claves y elimina usuarios (**editor**: edita contenido · **admin**: también gestiona usuarios).
  Cada quien cambia su clave con **Cambiar clave**. 5 intentos fallidos bloquean el usuario 10 minutos.
- Edita general, Instagram y grupo, premios, calendario, resultados y los 18 sponsors y pulsa **Guardar cambios**:
  se ve en la web al instante. Los logos y el póster se comprimen y se guardan en la base de datos.
- **Estado del torneo**: Inscripciones abiertas / Cerrado / En juego / Finalizado (etiqueta de la portada).
- **Cronograma**: ya trae las 27 fechas oficiales (octavos a final), ocultas. Actívalas con el interruptor
  o con “Activar todas” por fase. La hora se carga en hora de México y la web muestra MX, CO, RD y AR.
  Con **“Cargar equipos”** en cada fase pegas la plantilla (`GRUPO A` / `1. OLIS` …) y cada fecha muestra cuántos
  equipos tiene (`12/12`). Los equipos se guardan una sola vez y se ven en la web en el cronograma
  (“Ver equipos”, buscador “Busca tu equipo”) y en Resultados como “Equipos confirmados” hasta que se carguen puntos.
- **Resultados**: grupos de 12 por fase. Total = Kills + P.P − Sanciones. “Clasifican (top N)” marca quiénes pasan,
  y “Tabla general de la fase” suma todos los grupos de esa fase automáticamente.
- **Plantilla de equipos**: en cada grupo, “Pegar equipos” acepta la lista numerada (`1. OLIS`, `2. B17 E-SPORT`, …)
  y solo cambia los nombres. También acepta `Equipo, Kills, P.P, Sanciones` (sirve copiar desde Excel/Sheets).
  “Carga masiva” recibe varios grupos a la vez, cada bloque encabezado por `GRUPO A`, `GRUPO B`, …

## Publicar cambios de código

Los archivos se cargan con `?v=2.1.0` (en `index.html` y `admin.html`). Cuando cambies CSS/JS, sube ese número
(por ejemplo a `2.1.1`) para que los navegadores descarguen la versión nueva en vez de usar la que tienen en caché.
Los cambios hechos desde el admin (resultados, cronograma, etc.) no necesitan esto: se ven al recargar.

## Probar en local

```bash
python -m http.server 5173
```

Luego abre http://localhost:5173 (abrir el HTML con doble clic no funciona porque el navegador bloquea la carga de `data.json`).
