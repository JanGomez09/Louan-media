import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, api, getToken } from './api';
import { useApp } from './AppContext';
import { pushSupported, subscribePush, unsubscribePush } from './push';

// El chat vive aquí (y no en la página del chat) para poder avisar de mensajes nuevos
// y mostrar si estás activo aunque estés en otra sección de la app.
const Ctx = createContext(null);
export const useChat = () => useContext(Ctx);

const BASE_TITLE = document.title;
const PUSH_OFF = 'uscial_push_off'; // el usuario desactivó los avisos en este dispositivo
const canNotify = () => 'Notification' in window && Notification.permission === 'granted';

export function ChatProvider({ children }) {
  const { profile, getPerson } = useApp();
  const me = profile.uid;

  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState({}); // uid → { online, last_seen }
  const [typing, setTyping] = useState({}); // uid → true/false
  const [toast, setToast] = useState(null);
  const [pushOn, setPushOn] = useState(false);
  const [pushError, setPushError] = useState('');
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));

  const socketRef = useRef(null);
  const chatOpen = useRef(false);
  const typingTimers = useRef({});
  const latest = useRef({});
  latest.current = { getPerson };
  const pushOnRef = useRef(false);
  pushOnRef.current = pushOn;

  const loadHistory = useCallback(
    () =>
      api
        .get('/messages')
        .then((m) => {
          setMessages(m);
          setLoaded(true);
          setError('');
        })
        .catch((e) => setError(e.message)),
    []
  );

  useEffect(() => {
    const socket = io(API_URL, { auth: (cb) => cb({ token: getToken() }) });
    socketRef.current = socket;
    const visible = () => document.visibilityState === 'visible';

    // Mensaje de la otra persona: marcarlo visto si el chat está a la vista; si no, avisar
    const incoming = (m) => {
      if (chatOpen.current && visible()) {
        socket.emit('chat:read');
        return;
      }
      const name = latest.current.getPerson(m.sender_uid).username;
      if (visible()) {
        setToast({ id: m.id, name, text: m.text });
      } else if (canNotify() && !pushOnRef.current) {
        // Sin notificaciones push: aviso local (solo mientras la página siga abierta)
        try {
          const n = new Notification(name, { body: m.text.slice(0, 120), tag: 'uscial-chat' });
          n.onclick = () => {
            window.focus();
            window.location.hash = '#/chat';
            n.close();
          };
        } catch {
          /* algunos navegadores móviles no permiten notificaciones locales */
        }
      }
    };

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('presence:visible', visible());
      loadHistory().then(() => {
        if (chatOpen.current && visible()) socket.emit('chat:read');
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('presence', (list) => setPresence(Object.fromEntries(list.map((p) => [p.uid, p]))));

    socket.on('chat:typing', ({ uid, typing: on }) => {
      clearTimeout(typingTimers.current[uid]);
      setTyping((t) => ({ ...t, [uid]: on }));
      // Por si se pierde el aviso de "dejó de escribir"
      if (on) typingTimers.current[uid] = setTimeout(() => setTyping((t) => ({ ...t, [uid]: false })), 5000);
    });

    socket.on('chat:message', (m) => {
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      setTyping((t) => ({ ...t, [m.sender_uid]: false }));
      if (m.sender_uid !== me) incoming(m);
    });
    socket.on('chat:updated', (m) => setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x))));
    socket.on('chat:read', ({ ids, at }) => {
      const set = new Set(ids);
      setMessages((prev) => prev.map((x) => (set.has(x.id) ? { ...x, read_at: at } : x)));
    });

    const onVisibility = () => {
      socket.emit('presence:visible', visible());
      if (visible() && chatOpen.current) socket.emit('chat:read');
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      Object.values(typingTimers.current).forEach(clearTimeout);
      socket.disconnect();
    };
  }, [me, loadHistory]);

  // Si ya hay permiso, deja este dispositivo suscrito a las notificaciones push de la cuenta actual
  useEffect(() => {
    if (!pushSupported() || Notification.permission !== 'granted' || localStorage.getItem(PUSH_OFF)) return;
    subscribePush().then(() => setPushOn(true)).catch(() => {});
  }, [me]);

  // Mensajes sin ver de la otra persona
  const unread = useMemo(
    () => messages.filter((m) => m.sender_uid !== me && !m.read_at).length,
    [messages, me]
  );

  // Contador en el título de la pestaña
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [unread]);

  // El aviso dentro de la app desaparece solo
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const emit = useCallback((event, payload) => socketRef.current?.emit(event, payload), []);

  const value = useMemo(
    () => ({
      messages,
      loaded,
      error,
      connected,
      presence,
      typing,
      unread,
      toast,
      perm,
      pushOn,
      pushError,
      pushSupported: pushSupported(),
      send: (text, replyTo) => emit('chat:send', { text, replyTo: replyTo || null }),
      edit: (id, text) => emit('chat:edit', { id, text }),
      react: (id, emoji) => emit('chat:react', { id, emoji }),
      setTyping: (on) => emit('chat:typing', on),
      dismissToast: () => setToast(null),
      // La página del chat avisa cuando está abierta para marcar los mensajes como vistos
      setChatOpen: (open) => {
        chatOpen.current = open;
        if (open) {
          setToast(null);
          if (document.visibilityState === 'visible') socketRef.current?.emit('chat:read');
        }
      },
      enableNotifications: async () => {
        if (!('Notification' in window)) return;
        setPushError('');
        const p = await Notification.requestPermission();
        setPerm(p);
        if (p !== 'granted') return;
        localStorage.removeItem(PUSH_OFF);
        if (!pushSupported()) return;
        try {
          await subscribePush();
          setPushOn(true);
        } catch (e) {
          setPushError(e.message);
        }
      },
      disableNotifications: async () => {
        localStorage.setItem(PUSH_OFF, '1');
        await unsubscribePush().catch(() => {});
        setPushOn(false);
      },
    }),
    [messages, loaded, error, connected, presence, typing, unread, toast, perm, pushOn, pushError, emit]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
