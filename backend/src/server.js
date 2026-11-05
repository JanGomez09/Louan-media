import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import router, { toMsg } from './routes.js';
import { requireAuth, verify, login } from './auth.js';
import { connectDb, messages } from './db.js';

const origins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.set('trust proxy', 1); // detrás del proxy de Render/Railway, para ver la IP real
app.use(cors({ origin: origins }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.send('Uscial Media API funcionando'));
app.post('/auth/login', login);
app.use('/api', requireAuth, router);

// Manejo de errores (Express 5 captura también los errores de funciones async)
app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo supera el límite de 25 MB.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Algo salió mal en el servidor.' });
});

const server = http.createServer(app);

/* ---------- Chat en tiempo real ---------- */
const io = new Server(server, { cors: { origin: origins } });

io.use((socket, next) => {
  try {
    socket.data.user = verify(socket.handshake.auth?.token);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.on('chat:send', async (text) => {
    const clean = String(text || '').trim().slice(0, 2000);
    if (!clean) return;
    try {
      const doc = { sender_uid: socket.data.user.uid, text: clean, created_at: new Date() };
      const r = await messages.insertOne(doc);
      io.emit('chat:message', toMsg({ ...doc, _id: r.insertedId }));
    } catch (e) {
      console.error(e);
    }
  });
});

await connectDb();
const port = process.env.PORT || 4000;
server.listen(port, () => console.log(`Uscial Media API escuchando en el puerto ${port}`));
