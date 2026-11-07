// Uso: npm run vapid   → genera las claves VAPID para las notificaciones push (se hace una sola vez)
import { createECDH } from 'node:crypto';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
console.log(`VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${ecdh.getPrivateKey().toString('base64url')}`);
console.log('VAPID_SUBJECT=mailto:tu-correo@ejemplo.com');
