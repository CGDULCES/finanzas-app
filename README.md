# Finanzas — sistema personal + en pareja

App web simple (sin build, sin frameworks) para llevar tus finanzas, las de tu
pareja, y un fondo de ahorro compartido — cada sección con su propia
contraseña. Corre sobre **Supabase** (base de datos) y se despliega en
**Vercel** desde **GitHub**, igual que tu sistema de fichas de modelo.

## Qué incluye

- 3 secciones con contraseña independiente: `Mis finanzas`, `Finanzas de mi
  pareja`, `Ahorro en pareja`.
- Por sección: cuentas (efectivo / banco / ahorro), movimientos con
  categorías, dashboard de saldos, gráficos (ingresos vs. gastos, gasto por
  categoría) y — solo en la sección compartida — metas de ahorro con barra
  de progreso.
- Sin build step: son archivos estáticos (HTML/CSS/JS), Vercel los sirve tal
  cual.

## 1. Crear las tablas en Supabase

1. Entrá a tu proyecto en [supabase.com](https://supabase.com) (o creá uno
   nuevo).
2. Andá a **SQL Editor** → **New query**.
3. Pegá todo el contenido de `supabase-schema.sql` y ejecutalo.
4. Esto crea las tablas, bloquea el acceso directo a los datos (RLS sin
   policies) y deja las 3 secciones con la contraseña temporal
   **`cambiar123`**.

## 2. Conectar la app a tu proyecto

1. En Supabase: **Settings → API**.
2. Copiá **Project URL** y **anon public key**.
3. Abrí `config.js` y reemplazá:

```js
SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
SUPABASE_ANON_KEY: "TU-ANON-PUBLIC-KEY",
```

## 3. Probar en local

Abrí `index.html` con una extensión tipo "Live Server", o corré:

```bash
npx serve .
```

(Abrirlo con doble clic también funciona, pero algunos navegadores bloquean
`fetch` en `file://`; un servidor local evita ese problema.)

Entrá con la contraseña temporal `cambiar123` en cualquiera de las 3
secciones y después cambiala desde la pestaña **Ajustes** dentro de esa
sección.

## 4. Subir a GitHub y desplegar en Vercel

```bash
git init
git add .
git commit -m "Finanzas: primera version"
git remote add origin <tu-repo-en-github>
git push -u origin main
```

En [vercel.com](https://vercel.com): **New Project** → importá el repo → no
hace falta configurar build command ni output directory (es estático) →
Deploy.

## Cómo funciona la seguridad (leelo antes de cargar datos reales)

No usa login de usuarios de Supabase (lo descartaste a propósito por
simplicidad). En su lugar:

- Cada sección tiene una contraseña **hasheada** (bcrypt vía `pgcrypto`)
  guardada en la tabla `sections`.
- **Ninguna tabla es accesible directamente** con la anon key: activé Row
  Level Security y no le agregué ninguna policy, así que por defecto el
  acceso queda cerrado.
- Todo pasa por funciones `SECURITY DEFINER` (`login`, `get_state`,
  `add_transaction`, etc.) que primero verifican la contraseña o un token de
  sesión válido (dura 24 horas) antes de leer o escribir cualquier dato.

Esto significa que alguien que abra el código de la página y encuentre tu
`SUPABASE_URL` y `SUPABASE_ANON_KEY` (son públicas por diseño en cualquier
app de este tipo) **no puede leer tus datos sin la contraseña**, porque no
hay ninguna policy que se lo permita directamente. Es un buen nivel de
protección para uso personal, pero no es lo mismo que autenticación real de
usuarios (no hay recuperación de contraseña, ni roles, ni límite de
intentos). Si en algún momento querés subir el nivel de seguridad, el
siguiente paso natural sería migrar a Supabase Auth con un usuario por
persona.

## Extender la app

- **Nuevas categorías**: se agregan desde la pestaña *Cuentas* de cada
  sección (categorías son independientes por sección).
- **Transferencias entre cuentas**: hoy no están modeladas como tipo de
  movimiento aparte; se pueden simular con un gasto en una cuenta y un
  ingreso en otra.
- **Multi-moneda**: el esquema ya tiene una columna `currency` por cuenta,
  pero el formato de números en pantalla asume Guaraníes (`PYG`) — se
  ajusta en `config.js` (`CURRENCY`, `LOCALE`).
