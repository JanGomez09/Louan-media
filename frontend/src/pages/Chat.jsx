import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellRing, Check, CheckCheck, CornerUpLeft, Pencil, Plus, Send, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { useChat } from '../ChatContext';
import { Avatar } from '../components/Media';

// El selector con todos los emojis se descarga solo cuando se abre
const EmojiPicker = lazy(() =>
  import('emoji-picker-react').catch(() => ({
    default: () => <p className="notice">No se pudo cargar el selector de emojis.</p>,
  }))
);
const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const hour = (d) => new Date(d).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
const day = (d) => new Date(d).toLocaleDateString('es', { dateStyle: 'long' });
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

function ago(iso, nowMs) {
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'hace un momento';
  const m = Math.floor(s / 60);
  if (m < 60) return rtf.format(-m, 'minute');
  const h = Math.floor(m / 60);
  if (h < 24) return rtf.format(-h, 'hour');
  const d = Math.floor(h / 24);
  if (d < 7) return rtf.format(-d, 'day');
  return `el ${new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long' })}`;
}

export default function Chat() {
  const { profile, profiles, getPerson } = useApp();
  const chat = useChat();
  const { messages, loaded, error, connected, presence, typing, perm, pushOn, pushError, setChatOpen } = chat;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [active, setActive] = useState(null); // mensaje con la barra de acciones abierta
  const [picker, setPicker] = useState(null); // mensaje al que se le elige un emoji
  const [flash, setFlash] = useState(null);
  const [now, setNow] = useState(Date.now());

  const listRef = useRef(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimer = useRef(null);
  const isTyping = useRef(false);
  const prevLen = useRef(0);

  const partner = profiles.find((p) => p.uid !== profile.uid);
  const partnerTyping = Boolean(partner && typing[partner.uid]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  // Mientras esta pantalla está abierta, los mensajes nuevos se marcan como vistos
  useEffect(() => {
    setChatOpen(true);
    return () => setChatOpen(false);
  }, [setChatOpen]);

  // Refresca "activo hace X" cada 30 s
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // Baja al final al abrir y con mensajes nuevos, pero no te mueve si estás leyendo arriba
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const grew = messages.length > prevLen.current;
    const last = messages[messages.length - 1];
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (prevLen.current === 0 || (grew && (near || last?.sender_uid === profile.uid))) {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
    prevLen.current = messages.length;
  }, [messages, profile.uid]);

  useEffect(() => {
    const el = listRef.current;
    if (partnerTyping && el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }, [partnerTyping]);

  function stopTyping() {
    clearTimeout(typingTimer.current);
    if (isTyping.current) {
      isTyping.current = false;
      chat.setTyping(false);
    }
  }
  useEffect(() => () => stopTyping(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function onType(e) {
    setText(e.target.value);
    if (editing) return;
    if (!isTyping.current) {
      isTyping.current = true;
      chat.setTyping(true);
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 2500);
  }

  function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t || !connected) return;
    stopTyping();
    if (editing) {
      if (t !== editing.text) chat.edit(editing.id, t);
      setEditing(null);
    } else {
      chat.send(t, replyTo?.id);
      setReplyTo(null);
    }
    setText('');
  }

  const startReply = (m) => {
    setEditing(null);
    setReplyTo(m);
    setActive(null);
    inputRef.current?.focus();
  };
  const startEdit = (m) => {
    setReplyTo(null);
    setEditing(m);
    setText(m.text);
    setActive(null);
    inputRef.current?.focus();
  };
  const cancelContext = () => {
    if (editing) setText('');
    setEditing(null);
    setReplyTo(null);
  };
  const react = (m, emoji) => {
    chat.react(m.id, m.reactions?.[profile.uid] === emoji ? null : emoji); // tocar el mismo emoji lo quita
    setActive(null);
    setPicker(null);
  };
  const jumpTo = (id) => {
    const el = id && document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(id);
    setTimeout(() => setFlash(null), 1200);
  };

  // Mi último mensaje: si ya lo vieron, se muestra "Visto"
  const lastMine = [...messages].reverse().find((m) => m.sender_uid === profile.uid);
  const seenId = lastMine?.read_at ? lastMine.id : null;

  const pp = partner ? presence[partner.uid] : null;
  let status = 'Sin actividad reciente';
  if (partnerTyping) status = 'escribiendo…';
  else if (pp?.online) status = 'Activo ahora';
  else if (pp?.last_seen) status = `Activo ${ago(pp.last_seen, now)}`;

  return (
    <section className="page chat">
      <header className="chat-head">
        {partner && <Avatar person={partner} size={42} />}
        <div>
          <h1>{partner ? partner.username : 'Chat'}</h1>
          <div className="presence" aria-live="polite">
            <span className={`dot ${pp?.online ? 'on' : ''}`} />
            <span className={partnerTyping ? 'typing-text' : ''}>{status}</span>
          </div>
        </div>
        {chat.pushSupported && pushOn ? (
          <button className="btn ghost small push" onClick={chat.disableNotifications} title="Tocar para desactivar los avisos">
            <BellRing size={16} /> Avisos activados
          </button>
        ) : (
          (perm === 'default' || (perm === 'granted' && chat.pushSupported)) && (
            <button className="btn ghost small push" onClick={chat.enableNotifications}>
              <Bell size={16} /> Activar avisos
            </button>
          )
        )}
      </header>

      {!connected && <p className="notice">Sin conexión con el chat. Reconectando…</p>}
      {pushError && <p className="notice">{pushError}</p>}
      {perm === 'denied' && <p className="muted small">Los avisos están bloqueados en este navegador. Puedes permitirlos en los ajustes del sitio.</p>}
      {isIOS && !chat.pushSupported && (
        <p className="muted small">En iPhone, para recibir avisos abre la app desde la pantalla de inicio (Compartir → Añadir a pantalla de inicio).</p>
      )}
      {error && <p className="notice">{error}</p>}

      <div className="chat-list" ref={listRef} onClick={() => setActive(null)}>
        {!loaded && !error && <p className="muted center-text">Cargando mensajes…</p>}
        {loaded && messages.length === 0 && <p className="muted center-text">Escribe el primer mensaje.</p>}
        {messages.map((m, i) => {
          const newDay = i === 0 || day(messages[i - 1].created_at) !== day(m.created_at);
          return (
            <div key={m.id}>
              {newDay && <div className="day-sep">{day(m.created_at)}</div>}
              <Message
                m={m}
                mine={m.sender_uid === profile.uid}
                myUid={profile.uid}
                byId={byId}
                getPerson={getPerson}
                active={active === m.id}
                flash={flash === m.id}
                seen={seenId === m.id}
                onToggle={(id) => setActive((a) => (a === id ? null : id))}
                onReply={startReply}
                onEdit={startEdit}
                onReact={react}
                onMore={(msg) => setPicker(msg)}
                onJump={jumpTo}
              />
            </div>
          );
        })}
        {partnerTyping && (
          <div className="bubble-row">
            <Avatar person={partner} size={28} />
            <div className="bubble typing" aria-label={`${partner.username} está escribiendo`}>
              <i /><i /><i />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        {(replyTo || editing) && (
          <div className="ctx-bar">
            {replyTo ? <CornerUpLeft size={16} /> : <Pencil size={16} />}
            <div className="ctx-text">
              <strong>{replyTo ? `Respondiendo a ${getPerson(replyTo.sender_uid).username}` : 'Editando mensaje'}</strong>
              <span>{(replyTo || editing).text}</span>
            </div>
            <button type="button" className="icon-btn" onClick={cancelContext} aria-label="Cancelar">
              <X size={18} />
            </button>
          </div>
        )}
        <form className="chat-form" onSubmit={submit}>
          <input
            ref={inputRef}
            value={text}
            onChange={onType}
            onBlur={stopTyping}
            onKeyDown={(e) => e.key === 'Escape' && cancelContext()}
            placeholder={partner ? `Mensaje para ${partner.username}` : 'Escribe un mensaje'}
            maxLength={2000}
          />
          <button className="btn round" disabled={!text.trim() || !connected} aria-label={editing ? 'Guardar cambio' : 'Enviar'}>
            {editing ? <Check size={20} /> : <Send size={20} />}
          </button>
        </form>
      </div>

      {picker && (
        <div className="lightbox" onClick={() => setPicker(null)}>
          <div className="lightbox-box picker-box" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn close" onClick={() => setPicker(null)} aria-label="Cerrar">
              <X size={22} />
            </button>
            <Suspense fallback={<p className="muted center-text">Cargando emojis…</p>}>
              <EmojiPicker
                onEmojiClick={(d) => react(picker, d.emoji)}
                theme={document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'}
                emojiStyle="native"
                width="100%"
                height={380}
                lazyLoadEmojis
                searchPlaceholder="Buscar emoji"
                previewConfig={{ showPreview: false }}
              />
            </Suspense>
          </div>
        </div>
      )}
    </section>
  );
}

function Message({ m, mine, myUid, byId, getPerson, active, flash, seen, onToggle, onReply, onEdit, onReact, onMore, onJump }) {
  const author = getPerson(m.sender_uid);
  const orig = m.reply ? byId.get(m.reply.id) : null;
  const quoteName = m.reply ? getPerson(orig?.sender_uid ?? m.reply.sender_uid).username : '';
  const quoteText = m.reply ? orig?.text ?? m.reply.text : '';
  const myReaction = m.reactions?.[myUid];

  // Agrupa las reacciones por emoji: 👍 2, ❤️ 1…
  const groups = new Map();
  for (const [uid, emoji] of Object.entries(m.reactions || {})) {
    const g = groups.get(emoji) || { emoji, count: 0, mine: false };
    g.count += 1;
    if (uid === myUid) g.mine = true;
    groups.set(emoji, g);
  }

  return (
    <div id={`msg-${m.id}`} className={`bubble-row ${mine ? 'mine' : ''} ${flash ? 'flash' : ''}`}>
      {!mine && <Avatar person={author} size={28} />}
      <div className="bubble-col">
        <div
          className={`bubble ${active ? 'active' : ''}`}
          role="button"
          tabIndex={0}
          aria-expanded={active}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(m.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle(m.id);
            }
          }}
        >
          {m.reply && (
            <div
              className="quote-ref"
              onClick={(e) => {
                e.stopPropagation();
                onJump(orig?.id);
              }}
            >
              <strong>{quoteName}</strong>
              <span>{quoteText}</span>
            </div>
          )}
          <span>{m.text}</span>
          <div className="bubble-meta">
            {m.edited_at && <em>editado</em>}
            <time>{hour(m.created_at)}</time>
            {mine && (m.read_at ? <CheckCheck size={15} className="tick read" aria-label="Visto" /> : <Check size={15} className="tick" aria-label="Enviado" />)}
          </div>
        </div>

        {groups.size > 0 && (
          <div className="reactions">
            {[...groups.values()].map((g) => (
              <button
                key={g.emoji}
                className={`react-chip ${g.mine ? 'on' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onReact(m, g.emoji);
                }}
                aria-label={`${g.emoji} ${g.count}`}
              >
                {g.emoji}
                {g.count > 1 && <span>{g.count}</span>}
              </button>
            ))}
          </div>
        )}

        {seen && <div className="seen">Visto · {hour(m.read_at)}</div>}

        {active && (
          <div className="msg-actions" onClick={(e) => e.stopPropagation()}>
            <div className="quick">
              {QUICK.map((em) => (
                <button key={em} className={`emoji-btn ${myReaction === em ? 'on' : ''}`} onClick={() => onReact(m, em)} aria-label={`Reaccionar con ${em}`}>
                  {em}
                </button>
              ))}
              <button className="emoji-btn plus" onClick={() => onMore(m)} aria-label="Más emojis">
                <Plus size={18} />
              </button>
            </div>
            <div className="acts">
              <button className="act" onClick={() => onReply(m)}>
                <CornerUpLeft size={16} /> Responder
              </button>
              {mine && (
                <button className="act" onClick={() => onEdit(m)}>
                  <Pencil size={16} /> Editar
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
