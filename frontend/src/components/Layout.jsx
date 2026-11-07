import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, MessageCircle, Images, CalendarDays, Music, Settings } from 'lucide-react';
import { ChatProvider, useChat } from '../ChatContext';

const items = [
  { to: '/', label: 'Inicio', icon: Home, end: true },
  { to: '/chat', label: 'Chat', icon: MessageCircle },
  { to: '/album', label: 'Álbum', icon: Images },
  { to: '/calendario', label: 'Calendario', short: 'Fechas', icon: CalendarDays },
  { to: '/poesia', label: 'Poesía sonora', short: 'Poesía', icon: Music },
  { to: '/config', label: 'Ajustes', icon: Settings },
];

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      <span className="brand-name">Louan Uscial Media</span>
    </div>
  );
}

// Aviso dentro de la app cuando llega un mensaje y no estás en el chat
function ChatToast() {
  const { toast, dismissToast } = useChat();
  const navigate = useNavigate();
  if (!toast) return null;
  return (
    <button
      className="toast"
      onClick={() => {
        dismissToast();
        navigate('/chat');
      }}
    >
      <MessageCircle size={20} />
      <span className="toast-text">
        <strong>{toast.name}</strong>
        <span>{toast.text}</span>
      </span>
    </button>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const { unread } = useChat();

  return (
    <div className="shell">
      <nav className="nav" aria-label="Secciones">
        <Brand />
        {items.map(({ to, label, short, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="nav-link">
            <span className="ico">
              <Icon size={50} />
              {to === '/chat' && unread > 0 && (
                <span className="nav-badge" aria-label={`${unread} mensajes nuevos`}>{unread > 9 ? '9+' : unread}</span>
              )}
            </span>
            <span className="lbl-full">{label}</span>
            <span className="lbl-short">{short || label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="main">
        <div key={pathname} className="page-transition">
          <Outlet />
        </div>
      </main>
      <ChatToast />
    </div>
  );
}

export default function Layout() {
  return (
    <ChatProvider>
      <Shell />
    </ChatProvider>
  );
}
