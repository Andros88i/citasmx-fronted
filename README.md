# LatinLoveMx PRO (backend + front)

## Requisitos
- Node.js 16+ instalado
- npm

## Instalación local
1. Clona o copia los archivos en una carpeta.
2. `npm install`
3. Variables de entorno opcionales:
   - `JWT_SECRET` (recomendado) — secreto para tokens JWT.
   - `PORT` (por defecto 3000)
   - `DB_FILE` (por defecto `./llmx.sqlite`)
4. Ejecuta en desarrollo:
   - `npm run dev` (usa nodemon) o `npm start`

El servidor creará `llmx.sqlite` en la carpeta y sembrará perfiles demo en la primera ejecución.

## Endpoints principales (REST)
- `POST /api/register` — body JSON { name, email, password, age, bio }
- `POST /api/login` — body JSON { email, password } -> devuelve `{ token }`
- `GET /api/profiles` — lista de perfiles (opcional ?exclude=meId)
- `POST /api/like` — auth required; body { to } -> guarda like, crea match si hay inverso
- `GET /api/matches` — auth required
- `GET /api/chats` — auth required — lista de chats (por match)
- `GET /api/messages/:chatId` — auth required — obtiene mensajes
- `POST /api/messages/:chatId` — auth required — guarda mensaje (alternativa a sockets)

## WebSocket (Socket.io)
- Cliente se conecta con auth: `io(url, { auth: { token } })`
- Eventos:
  - `joinChat` (chatId)
  - `leaveChat` (chatId)
  - `sendMessage` ({ chatId, text })
  - recibir: `message` ({ chatId, from, text, ts })
  - recibir: `matched` (cuando alguien te hace match)

## Despliegue
- Puedes desplegar en Render, Railway, Heroku, Vercel (Serverless con WebSocket no siempre compatible), DigitalOcean App, etc.
- Asegúrate de configurar `JWT_SECRET` en variables de entorno del servicio.
