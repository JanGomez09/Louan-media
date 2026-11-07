import { api } from './api';

// Notificaciones push: funcionan con la app cerrada, mediante un service worker.
const SW_URL = `${import.meta.env.BASE_URL}sw.js`;

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const keyToBytes = (b64url) => {
  const b64 = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

async function getRegistration() {
  await navigator.serviceWorker.register(SW_URL);
  return navigator.serviceWorker.ready;
}

/** Suscribe este dispositivo y lo registra en el servidor (pide permiso antes, desde la interfaz). */
export async function subscribePush() {
  const { key } = await api.get('/push/key');
  if (!key) throw new Error('Las notificaciones no están configuradas en el servidor.');
  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(key) });
    } catch (e) {
      throw new Error('No se pudo activar las notificaciones en este navegador.');
    }
  }
  await api.post('/push/subscribe', { subscription: sub.toJSON() });
  return sub;
}

/** Quita la suscripción de este dispositivo (en el servidor y en el navegador). */
export async function unsubscribePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  try {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint });
  } catch {
    /* si el servidor no responde, igual se quita en el navegador */
  }
  await sub.unsubscribe();
}
