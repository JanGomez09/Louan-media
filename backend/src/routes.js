import { Router } from 'express';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { bucket, events, messages, posts, profiles, pushSubs, quotes } from './db.js';
import { publicKey } from './push.js';

const router = Router();
const MAX_BYTES = 25 * 1024 * 1024; // límite de videos y archivos
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 10 } });

const isMedia = (f) => /^(image|video)\//.test(f.mimetype);
const bad = (res, msg) => res.status(400).json({ error: msg });
const notFound = (res, msg = 'No se encontró el elemento.') => res.status(404).json({ error: msg });
const toId = (s) => (ObjectId.isValid(s) ? new ObjectId(s) : null);
const iso = (d) => new Date(d).toISOString();

/* ---------- Formatos de respuesta ---------- */
const profileShape = (d) => ({
  uid: d._id,
  email: d.email,
  username: d.username,
  avatar_media_id: d.avatar_media_id ? d.avatar_media_id.toString() : null,
  theme: d.theme,
});
const mediaShape = (id, ownerUid, mime, date) => ({
  id: id.toString(),
  owner_uid: ownerUid,
  mime,
  created_at: iso(date),
});
const commentShape = (c) => ({ id: c.id.toString(), uid: c.uid, text: c.text, created_at: iso(c.created_at) });
export const toMsg = (d) => ({
  id: d._id.toString(),
  sender_uid: d.sender_uid,
  text: d.text,
  created_at: iso(d.created_at),
  edited_at: d.edited_at ? iso(d.edited_at) : null,
  // Los mensajes anteriores a esta función no tienen read_at: se consideran leídos
  read_at: d.read_at ? iso(d.read_at) : d.read_at === undefined ? iso(d.created_at) : null,
  reply: d.reply ? { id: d.reply.id.toString(), sender_uid: d.reply.sender_uid, text: d.reply.text } : null,
  reactions: d.reactions || {},
});

/** Guarda un archivo en GridFS y devuelve su id. */
function saveFile(file, ownerUid, kind) {
  return new Promise((resolve, reject) => {
    const up = bucket.openUploadStream(file.originalname || 'archivo', {
      metadata: { owner_uid: ownerUid, kind, mime: file.mimetype },
    });
    up.once('error', reject);
    up.once('finish', () => resolve(up.id));
    up.end(file.buffer);
  });
}

/* ---------- Perfil ---------- */

router.get('/me', async (req, res) => {
  const { uid, email } = req.user;
  const doc = await profiles.findOneAndUpdate(
    { _id: uid },
    {
      $set: { email },
      $setOnInsert: { username: email.split('@')[0], avatar_media_id: null, theme: 'light', created_at: new Date() },
    },
    { upsert: true, returnDocument: 'after' }
  );
  res.json(profileShape(doc));
});

router.patch('/me', async (req, res) => {
  const { username, theme } = req.body || {};
  const set = {};
  if (username !== undefined) {
    const name = String(username).trim();
    if (name.length < 2 || name.length > 30) {
      return bad(res, 'El nombre de usuario debe tener entre 2 y 30 caracteres.');
    }
    set.username = name;
  }
  if (theme !== undefined) {
    if (!['light', 'dark'].includes(theme)) return bad(res, 'Tema no válido.');
    set.theme = theme;
  }
  const doc = Object.keys(set).length
    ? await profiles.findOneAndUpdate({ _id: req.user.uid }, { $set: set }, { returnDocument: 'after' })
    : await profiles.findOne({ _id: req.user.uid });
  if (!doc) return notFound(res);
  res.json(profileShape(doc));
});

router.post('/me/avatar', upload.single('file'), async (req, res) => {
  const f = req.file;
  if (!f || !f.mimetype.startsWith('image/')) return bad(res, 'Elige una imagen.');
  const { uid } = req.user;
  const old = await profiles.findOne({ _id: uid }, { projection: { avatar_media_id: 1 } });
  if (!old) return notFound(res);
  const id = await saveFile(f, uid, 'avatar');
  const doc = await profiles.findOneAndUpdate({ _id: uid }, { $set: { avatar_media_id: id } }, { returnDocument: 'after' });
  if (old.avatar_media_id) bucket.delete(old.avatar_media_id).catch(() => {});
  res.json(profileShape(doc));
});

router.get('/profiles', async (_req, res) => {
  const docs = await profiles.find().toArray();
  res.json(
    docs.map((d) => ({
      uid: d._id,
      username: d.username,
      avatar_media_id: d.avatar_media_id ? d.avatar_media_id.toString() : null,
    }))
  );
});

/* ---------- Álbum (media) ---------- */

router.get('/media', async (_req, res) => {
  const docs = await bucket.find({ 'metadata.kind': 'album' }).sort({ uploadDate: -1 }).toArray();
  res.json(docs.map((d) => mediaShape(d._id, d.metadata.owner_uid, d.metadata.mime, d.uploadDate)));
});

router.post('/media', upload.array('files', 10), async (req, res) => {
  const files = req.files || [];
  if (!files.length || !files.every(isMedia)) return bad(res, 'Solo se permiten fotos y videos.');
  const out = [];
  for (const f of files) {
    const id = await saveFile(f, req.user.uid, 'album');
    out.push(mediaShape(id, req.user.uid, f.mimetype, new Date()));
  }
  res.status(201).json(out);
});

router.get('/media/:id/file', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return notFound(res, 'Archivo no encontrado.');
  const [file] = await bucket.find({ _id: id }).limit(1).toArray();
  if (!file) return notFound(res, 'Archivo no encontrado.');
  res.set({
    'Content-Type': file.metadata?.mime || 'application/octet-stream',
    'Content-Length': String(file.length),
    'Cache-Control': 'private, max-age=86400',
  });
  bucket.openDownloadStream(id).on('error', () => res.destroy()).pipe(res);
});

router.delete('/media/:id', async (req, res) => {
  const id = toId(req.params.id);
  const [file] = id ? await bucket.find({ _id: id }).limit(1).toArray() : [];
  if (!file || file.metadata?.kind !== 'album' || file.metadata.owner_uid !== req.user.uid) {
    return notFound(res, 'Solo puedes borrar lo que subiste tú.');
  }
  await bucket.delete(id);
  await posts.deleteMany({ media_id: id }); // también se quitan las publicaciones que la usaban
  res.json({ ok: true });
});

/* ---------- Publicaciones (likes y comentarios viven dentro de cada publicación) ---------- */

router.get('/posts', async (req, res) => {
  const docs = await posts.find().sort({ _id: -1 }).limit(50).toArray();
  res.json(
    docs.map((p) => ({
      id: p._id.toString(),
      author_uid: p.author_uid,
      media_id: p.media_id.toString(),
      mime: p.mime,
      caption: p.caption,
      created_at: iso(p.created_at),
      likes: p.likes.length,
      liked: p.likes.includes(req.user.uid),
      comments: p.comments.map(commentShape),
    }))
  );
});

router.post('/posts', async (req, res) => {
  const mediaId = toId(req.body?.mediaId);
  const caption = String(req.body?.caption || '').trim().slice(0, 2200);
  const [file] = mediaId ? await bucket.find({ _id: mediaId }).limit(1).toArray() : [];
  if (!file || file.metadata?.kind !== 'album') return bad(res, 'Esa foto no está en el álbum.');
  const r = await posts.insertOne({
    author_uid: req.user.uid,
    media_id: mediaId,
    mime: file.metadata.mime,
    caption,
    created_at: new Date(),
    likes: [],
    comments: [],
  });
  res.status(201).json({ id: r.insertedId.toString() });
});

router.delete('/posts/:id', async (req, res) => {
  const id = toId(req.params.id);
  const r = id ? await posts.deleteOne({ _id: id, author_uid: req.user.uid }) : { deletedCount: 0 };
  if (!r.deletedCount) return notFound(res, 'Solo puedes borrar tus publicaciones.');
  res.json({ ok: true });
});

router.post('/posts/:id/like', async (req, res) => {
  const id = toId(req.params.id);
  const post = id ? await posts.findOne({ _id: id }, { projection: { likes: 1 } }) : null;
  if (!post) return notFound(res);
  const has = post.likes.includes(req.user.uid);
  await posts.updateOne({ _id: id }, has ? { $pull: { likes: req.user.uid } } : { $addToSet: { likes: req.user.uid } });
  res.json({ liked: !has });
});

router.post('/posts/:id/comments', async (req, res) => {
  const id = toId(req.params.id);
  const text = String(req.body?.text || '').trim().slice(0, 1000);
  if (!text) return bad(res, 'Escribe un comentario.');
  const comment = { id: new ObjectId(), uid: req.user.uid, text, created_at: new Date() };
  const r = id ? await posts.updateOne({ _id: id }, { $push: { comments: comment } }) : { matchedCount: 0 };
  if (!r.matchedCount) return notFound(res);
  res.status(201).json(commentShape(comment));
});

/* ---------- Calendario compartido ---------- */
// Las fechas se guardan como texto "AAAA-MM-DD" (día completo, sin zona horaria),
// así que se ven en el mismo día en cualquier dispositivo.

const EVENT_TYPES = ['aniversario', 'cumpleanos', 'festividad', 'otro'];

const validDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const year = Number(s.slice(0, 4));
  if (year < 1900 || year > 2200) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s); // rechaza 30 de febrero, etc.
};

const eventShape = (d) => ({
  id: d._id.toString(),
  title: d.title,
  date: d.date,
  type: d.type,
  yearly: d.yearly,
  note: d.note,
  created_by: d.created_by,
});

function readEvent(body) {
  const title = String(body?.title || '').trim();
  const date = String(body?.date || '');
  const note = String(body?.note || '').trim().slice(0, 300);
  if (!title || title.length > 80) return { error: 'El título debe tener entre 1 y 80 caracteres.' };
  if (!validDate(date)) return { error: 'La fecha no es válida.' };
  if (!EVENT_TYPES.includes(body?.type)) return { error: 'Tipo de fecha no válido.' };
  return { value: { title, date, type: body.type, yearly: Boolean(body.yearly), note } };
}

router.get('/events', async (_req, res) => {
  const docs = await events.find().sort({ date: 1 }).toArray();
  res.json(docs.map(eventShape));
});

router.post('/events', async (req, res) => {
  const { value, error } = readEvent(req.body);
  if (error) return bad(res, error);
  const doc = { ...value, created_by: req.user.uid, created_at: new Date() };
  const r = await events.insertOne(doc);
  res.status(201).json(eventShape({ ...doc, _id: r.insertedId }));
});

router.patch('/events/:id', async (req, res) => {
  const id = toId(req.params.id);
  const { value, error } = readEvent(req.body);
  if (error) return bad(res, error);
  const doc = id ? await events.findOneAndUpdate({ _id: id }, { $set: value }, { returnDocument: 'after' }) : null;
  if (!doc) return notFound(res);
  res.json(eventShape(doc));
});

router.delete('/events/:id', async (req, res) => {
  const id = toId(req.params.id);
  const r = id ? await events.deleteOne({ _id: id }) : { deletedCount: 0 };
  if (!r.deletedCount) return notFound(res);
  res.json({ ok: true });
});

/* ---------- Diccionario de poesía sonora ---------- */

const quoteShape = (d) => ({
  id: d._id.toString(),
  artist: d.artist,
  song: d.song,
  quote: d.quote,
  added_by: d.added_by,
  created_at: iso(d.created_at),
});

router.get('/quotes', async (_req, res) => {
  // El orden alfabético (con acentos y ñ) lo aplica el frontend
  const docs = await quotes.find().toArray();
  res.json(docs.map(quoteShape));
});

router.post('/quotes', async (req, res) => {
  const artist = String(req.body?.artist || '').trim();
  const song = String(req.body?.song || '').trim();
  const quote = String(req.body?.quote || '').trim();
  if (!artist || artist.length > 100) return bad(res, 'El artista debe tener entre 1 y 100 caracteres.');
  if (!song || song.length > 150) return bad(res, 'La canción debe tener entre 1 y 150 caracteres.');
  if (!quote || quote.length > 1000) return bad(res, 'La cita debe tener entre 1 y 1000 caracteres.');
  const doc = { artist, song, quote, added_by: req.user.uid, created_at: new Date() };
  const r = await quotes.insertOne(doc);
  res.status(201).json(quoteShape({ ...doc, _id: r.insertedId }));
});

router.delete('/quotes/:id', async (req, res) => {
  const id = toId(req.params.id);
  const r = id ? await quotes.deleteOne({ _id: id, added_by: req.user.uid }) : { deletedCount: 0 };
  if (!r.deletedCount) return notFound(res, 'Solo puedes borrar las citas que añadiste tú.');
  res.json({ ok: true });
});

/* ---------- Notificaciones push ---------- */

router.get('/push/key', (_req, res) => res.json({ key: publicKey() }));

router.post('/push/subscribe', async (req, res) => {
  const sub = req.body?.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) {
    return bad(res, 'Suscripción no válida.');
  }
  await pushSubs.updateOne(
    { endpoint: sub.endpoint },
    {
      $set: { uid: req.user.uid, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, updated_at: new Date() },
      $setOnInsert: { created_at: new Date() },
    },
    { upsert: true }
  );
  res.status(201).json({ ok: true });
});

router.post('/push/unsubscribe', async (req, res) => {
  await pushSubs.deleteOne({ endpoint: String(req.body?.endpoint || ''), uid: req.user.uid });
  res.json({ ok: true });
});

/* ---------- Chat (historial; los mensajes nuevos van por Socket.IO) ---------- */

router.get('/messages', async (_req, res) => {
  const docs = await messages.find().sort({ _id: -1 }).limit(200).toArray();
  res.json(docs.reverse().map(toMsg));
});

export default router;
