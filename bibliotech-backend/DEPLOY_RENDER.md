# Publicar BiblioTech en Internet (Render)

Este proyecto está preparado como punto de partida para desplegarse en Render con un disco persistente para SQLite.

## Antes de publicar
- El servicio web con disco persistente requiere un plan de pago compatible. Comprueba el precio actual de Render antes de confirmar.
- No subas contraseñas reales a Git ni compartas el archivo `.env`.
- Este paquete no incluye la base de datos que tienes en tu computador. Exporta un respaldo desde BiblioTech antes de migrar los datos.

## Pasos
1. Descomprime el ZIP.
2. Sube la carpeta `bibliotech-backend` a un repositorio privado de GitHub.
3. En Render, crea un **Blueprint** y conecta ese repositorio.
4. Render leerá `render.yaml`. Cuando lo solicite, define `ADMIN_PASSWORD` con una contraseña larga y única.
5. Espera a que termine el despliegue y abre la URL que Render asigne, por ejemplo `https://bibliotech.onrender.com`.
6. Inicia sesión con el usuario `admin` y la contraseña que configuraste.
7. En Configuración, cambia la contraseña si es necesario e importa el respaldo exportado desde la instalación local.

## Importante
- `DB_FILE=/var/data/bibliotech.db` guarda SQLite en el disco persistente, para evitar que los datos desaparezcan en cada despliegue.
- `COOKIE_SECURE=1` activa cookies seguras para HTTPS; `TRUST_PROXY=1` permite reconocer el proxy HTTPS del alojamiento.
- `SEED_DEMO=0` evita cargar registros de demostración en la primera ejecución.
- No borres el disco persistente: contiene la base de datos.
- Si la aplicación local ya tiene libros, lectores y préstamos reales, exporta un respaldo y conserva otra copia antes de importarlo en producción.
