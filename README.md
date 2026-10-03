# Kanban Workspace

Aplicación Kanban construida con React, TypeScript, Vite y Supabase.

## Desarrollo local

1. Instala dependencias:

   ```bash
   npm ci
   ```

2. Crea `.env.local` a partir de `.env.example`:

   ```env
   VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=tu-clave-publicable
   ```

   Solo se debe usar la clave publicable de Supabase en el frontend. Nunca
   agregues claves `service_role` ni secretos privados a variables `VITE_*`.

3. Ejecuta la aplicación:

   ```bash
   npm run dev
   ```

## Supabase

Para una configuración inicial rápida, ejecuta una sola vez
`supabase/production_setup.sql` en el SQL Editor de Supabase. Este script
consolida las migraciones de columnas, tareas, prioridades, colaboradores,
invitaciones y nombres de perfil. Es idempotente para poder reintentarlo si
Supabase informa un error de conexión.

Como alternativa para equipos que usan Supabase CLI, ejecuta las migraciones
de `supabase/migrations/` en orden, pero no ejecutes ambas opciones como parte
del mismo proceso inicial.

Luego, en Authentication > URL Configuration, agrega:

- URL del sitio: `https://<usuario>.github.io/<repositorio>/`
- Redirect URL: `https://<usuario>.github.io/<repositorio>/`

Para desarrollo local agrega también:

- `http://localhost:5173/`

Las políticas RLS deben permanecer activas. El frontend no contiene permisos
administrativos y las claves privadas no deben exponerse.

## GitHub Pages

El workflow [deploy-pages.yml](./.github/workflows/deploy-pages.yml) construye
y publica automáticamente cada push a `master` o `main`.

En el repositorio, configura estos **Actions secrets**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Después, en Settings > Pages, selecciona **GitHub Actions** como fuente de
despliegue. La aplicación quedará disponible en:

```text
https://<usuario>.github.io/<repositorio>/
```

El build usa la ruta del repositorio automáticamente y publica `404.html`
para que las rutas de React Router sigan funcionando al recargar una página.

## Validación

```bash
npm run lint
npm run build
```
