# BiblioTech – con backend

Sistema de biblioteca con **API REST (Express)**, base de datos **SQLite** (un solo archivo) e **inicio de sesión**.

## Requisitos
- [Node.js](https://nodejs.org) versión 18 o superior (recomendado 20+).

## Ejecutar en tu computador
```bash
cd bibliotech-backend
npm install
npm start
```
Abre **http://localhost:3000**.

En el **primer arranque** se crea el usuario administrador y su contraseña aparece en la consola:

```
Usuario:    admin
Contraseña: xxxxxxxxxxxx   (cámbiala en Configuración)
```

Para elegir tú la contraseña inicial, defínela antes de arrancar por primera vez:

- Windows (PowerShell): `$env:ADMIN_PASSWORD="MiClaveSegura123"; npm start`
- Mac / Linux: `ADMIN_PASSWORD="MiClaveSegura123" npm start`

Después puedes cambiarla en **Configuración → Cambiar contraseña**.

> Si olvidas la contraseña: borra la carpeta `data/` (se pierden los datos) o crea una copia de seguridad y arranca de nuevo.

## Datos
- Se guardan en `data/bibliotech.db`. **Haz copia de esa carpeta** o usa *Configuración → Exportar respaldo*.
- La primera vez se cargan datos de ejemplo. Para empezar vacío: `SEED_DEMO=0 npm start` (antes del primer arranque), o usa el botón *Vaciar todo y empezar de cero* en Configuración.

## Variables de entorno (todas opcionales)
| Variable | Para qué sirve | Por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `3000` |
| `ADMIN_USER` | Usuario inicial | `admin` |
| `ADMIN_PASSWORD` | Contraseña inicial (solo se usa al crear el usuario) | aleatoria, se muestra en consola |
| `DB_FILE` | Ruta del archivo SQLite | `./data/bibliotech.db` |
| `SESSION_SECRET` | Clave para firmar sesiones | se genera y guarda sola |
| `APP_TIMEZONE` | Zona horaria para "hoy" y vencimientos | `America/Bogota` |
| `SEED_DEMO` | `0` = no cargar datos de ejemplo | cargar |
| `COOKIE_SECURE` | `1` = cookie solo por HTTPS | desactivado |
| `TRUST_PROXY` | `1` si estás detrás de un proxy (Render, Railway, Nginx…) | desactivado |

## Subirlo a internet
1. Usa un servicio donde puedas **guardar un disco persistente** (Railway, Render con disco, Fly.io con volumen, o un VPS). SQLite escribe en un archivo: si el disco se borra en cada despliegue, perderás los datos.
2. Define `DB_FILE` apuntando al disco persistente, `ADMIN_PASSWORD`, `COOKIE_SECURE=1` y `TRUST_PROXY=1`.
3. Sirve **siempre con HTTPS** (esos servicios lo incluyen).
4. Comando de inicio: `npm start`.

## Estructura
```
server.js          API + reglas de negocio + login
public/            app.js, styles.css, login.html (archivos públicos)
private/index.html la aplicación (solo se entrega con sesión iniciada)
data/              base de datos SQLite (se crea sola)
```

## API (resumen)
Todas requieren sesión, excepto `login`. Las escrituras deben enviar la cabecera `X-Requested-With: bibliotech`.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/login`, `/api/logout` | Iniciar / cerrar sesión |
| GET | `/api/state` | Libros, lectores, préstamos, perfil y configuración |
| POST / PUT / DELETE | `/api/books[/:id]` | Crear / editar / eliminar libro |
| POST / PUT / DELETE | `/api/readers[/:id]` | Crear / editar / eliminar lector |
| POST | `/api/readers/:id/toggle` | Suspender / reactivar |
| POST | `/api/loans` | Registrar préstamo `{readerId, bookId, days}` |
| POST | `/api/loans/:id/return` · `/renew` | Devolver · renovar +7 días |
| PUT | `/api/profile` · `/api/config` · `/api/notifs` | Perfil, parámetros, avisos leídos |
| POST | `/api/password` | Cambiar contraseña |
| POST | `/api/admin/clear` · `/reset-demo` · `/import` | Administración de datos |

## Reglas que valida el servidor
- No se presta un libro sin ejemplares disponibles.
- No se presta a lectores suspendidos o con préstamos vencidos.
- Se respeta el máximo de libros por lector.
- No se elimina un libro o lector con préstamos activos, ni se bajan los ejemplares por debajo de los prestados.
- ISBN y documento no se pueden repetir.
