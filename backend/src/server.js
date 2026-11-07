import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { ObjectId } from 'mongodb';
import { Server } from 'socket.io';
import router, { toMsg } from './routes.js';
import { requireAuth, verify, login } from './auth.js';
import { connectDb, messages, profiles } from './db.js';
import { pushToOthers } from './push.js';

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

const toObjectId = (s) => (typeof s === 'string' && /^[0-9a-f]{24}$/i.test(s) ? new ObjectId(s) : null);

// Un solo emoji (puede ser compuesto: bandera, tono de piel, familia...)
const segmenter = new Intl.Segmenter();
const isEmoji = (s) =>
  typeof s === 'string' &&
  s.length > 0 &&
  s.length <= 64 &&
  [...segmenter.segment(s)].length === 1 &&
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3/u.test(s);

/* ---------- Presencia: "activo" = tiene la app abierta y visible en algún dispositivo ---------- */
const sessions = new Map(); // socket.id → { uid, visible }
const isActive = (uid) => [...sessions.values()].some((s) => s.uid === uid && s.visible);

async function presenceSnapshot() {
  const docs = await profiles.find({}, { projection: { last_seen: 1 } }).toArray();
  return docs.map((d) => ({
    uid: d._id,
    online: isActive(d._id),
    last_seen: d.last_seen ? d.last_seen.toISOString() : null,
  }));
}
const broadcastPresence = async () => io.emit('presence', await presenceSnapshot());

async function setVisible(socket, visible) {
  const session = sessions.get(socket.id);
  if (!session) return;
  const before = isActive(session.uid);
  session.visible = visible;
  const after = isActive(session.uid);
  if (before && !after) await profiles.updateOne({ _id: session.uid }, { $set: { last_seen: new Date() } });
  if (before !== after) await broadcastPresence();
}

const safe = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (e) {
    console.error(e);
  }
};

io.on('connection', (socket) => {
  const { uid } = socket.data.user;
  sessions.set(socket.id, { uid, visible: false });
  presenceSnapshot().then((list) => socket.emit('presence', list)).catch(console.error);

  // El cliente avisa si la pestaña está visible u oculta
  socket.on('presence:visible', safe((visible) => setVisible(socket, Boolean(visible))));

  // "Está escribiendo…"
  socket.on('chat:typing', (typing) => socket.broadcast.emit('chat:typing', { uid, typing: Boolean(typing) }));

  // Enviar mensaje (opcionalmente como respuesta a otro)
  socket.on(
    'chat:send',
    safe(async (payload) => {
      const raw = typeof payload === 'string' ? payload : payload?.text;
      const text = String(raw || '').trim().slice(0, 2000);
      if (!text) return;
      let reply = null;
      const replyId = toObjectId(payload?.replyTo);
      if (replyId) {
        const orig = await messages.findOne({ _id: replyId });
        if (orig) reply = { id: orig._id, sender_uid: orig.sender_uid, text: orig.text.slice(0, 140) };
      }
      const doc = {
        sender_uid: uid,
        text,
        created_at: new Date(),
        edited_at: null,
        read_at: null,
        reply,
        reactions: {},
      };
      const r = await messages.insertOne(doc);
      io.emit('chat:message', toMsg({ ...doc, _id: r.insertedId }));

      // Notificación push a la otra persona, salvo que ya tenga la app abierta y visible
      const me = await profiles.findOne({ _id: uid }, { projection: { username: 1 } });
      pushToOthers(uid, { title: me?.username || 'Nuevo mensaje', body: text.slice(0, 140), url: '#/chat', tag: 'uscial-chat' }, isActive).catch(console.error);
    })
  );

  // Editar un mensaje propio
  socket.on(
    'chat:edit',
    safe(async ({ id, text } = {}) => {
      const _id = toObjectId(id);
      const clean = String(text || '').trim().slice(0, 2000);
      if (!_id || !clean) return;
      const doc = await messages.findOneAndUpdate(
        { _id, sender_uid: uid },
        { $set: { text: clean, edited_at: new Date() } },
        { returnDocument: 'after' }
      );
      if (doc) io.emit('chat:updated', toMsg(doc));
    })
  );

  // Reaccionar con un emoji (uno por persona; emoji = null lo quita)
  socket.on(
    'chat:react',
    safe(async ({ id, emoji } = {}) => {
      const _id = toObjectId(id);
      if (!_id || (emoji !== null && !isEmoji(emoji))) return;
      const key = `reactions.${uid}`;
      const doc = await messages.findOneAndUpdate(
        { _id },
        emoji === null ? { $unset: { [key]: '' } } : { $set: { [key]: emoji } },
        { returnDocument: 'after' }
      );
      if (doc) io.emit('chat:updated', toMsg(doc));
    })
  );

  // Marcar como vistos los mensajes de la otra persona
  socket.on(
    'chat:read',
    safe(async () => {
      const unread = await messages
        .find({ sender_uid: { $ne: uid }, read_at: { $type: 'null' } }, { projection: { _id: 1 } })
        .toArray();
      if (!unread.length) return;
      const at = new Date();
      await messages.updateMany({ _id: { $in: unread.map((d) => d._id) } }, { $set: { read_at: at } });
      io.emit('chat:read', { reader: uid, ids: unread.map((d) => d._id.toString()), at: at.toISOString() });
    })
  );

  socket.on(
    'disconnect',
    safe(async () => {
      await setVisible(socket, false);
      sessions.delete(socket.id);
      socket.broadcast.emit('chat:typing', { uid, typing: false });
    })
  );
});

await connectDb();
const port = process.env.PORT || 4000;
server.listen(port, () => console.log(`Uscial Media API escuchando en el puerto ${port}`));
