import webpush from 'web-push';
import { pushSubs } from './db.js';

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;

export const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('Notificaciones push desactivadas: faltan VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en el .env (genéralas con: npm run vapid)');
}

export const publicKey = () => (pushEnabled ? VAPID_PUBLIC_KEY : null);

/** Envía una notificación a todos los dispositivos de la otra persona (salvo los que `skip(uid)` descarte). */
export async function pushToOthers(senderUid, payload, skip = () => false) {
  if (!pushEnabled) return;
  const subs = await pushSubs.find({ uid: { $ne: senderUid } }).toArray();
  const body = JSON.stringify(payload);
  await Promise.all(
    subs
      .filter((s) => !skip(s.uid))
      .map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 86400, urgency: 'high' });
        } catch (e) {
          // 404/410: el dispositivo ya no existe (se desinstaló o se quitó el permiso)
          if (e.statusCode === 404 || e.statusCode === 410) await pushSubs.deleteOne({ endpoint: s.endpoint });
          else console.error('push:', e.statusCode || e.message);
        }
      })
  );
}
