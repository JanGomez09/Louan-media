import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Pencil, X } from 'lucide-react';
import { api } from '../api';
import { daysBetween, keyOf, nextOccurrence, occursOn, parse, yearsSince, ymd } from '../dates';

const TYPES = {
  aniversario: { label: 'Aniversario', icon: '💞' },
  cumpleanos: { label: 'Cumpleaños', icon: '🎂' },
  festividad: { label: 'Festividad', icon: '🎄' },
  otro: { label: 'Otro', icon: '⭐' },
};
const PRESETS = [
  { title: 'San Valentín', md: '02-14' },
  { title: 'Navidad', md: '12-25' },
  { title: 'Año Nuevo', md: '01-01' },
];
const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** Fecha y hora del dispositivo, actualizadas al volver a la app y cada 30 segundos. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, []);
  return now;
}

const longDate = (key) => {
  const { y, m, d } = parse(key);
  return new Date(y, m - 1, d).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

function countdown(n) {
  if (n === 0) return 'Hoy';
  if (n === 1) return 'Mañana';
  return `En ${n} días`;
}

function yearsLabel(ev, key) {
  if (!ev.yearly) return '';
  const n = yearsSince(ev, key);
  if (n <= 0) return '';
  return ev.type === 'aniversario' ? `${n}.º aniversario` : `${n} ${n === 1 ? 'año' : 'años'}`;
}

export default function Calendar() {
  const now = useNow();
  const today = keyOf(now);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => ({ y: now.getFullYear(), m: now.getMonth() + 1 }));
  const [selected, setSelected] = useState(today);
  const [form, setForm] = useState(null);

  useEffect(() => {
    api.get('/events').then(setEvents).catch((e) => setError(e.message));
  }, []);

  const list = events || [];
  const first = new Date(view.y, view.m - 1, 1);
  const offset = (first.getDay() + 6) % 7; // la semana empieza en lunes
  const daysInMonth = new Date(view.y, view.m, 0).getDate();
  const cells = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const move = (delta) =>
    setView(({ y, m }) => {
      const d = new Date(y, m - 1 + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    });
  const goToday = () => {
    setView({ y: now.getFullYear(), m: now.getMonth() + 1 });
    setSelected(today);
  };

  const dayEvents = list.filter((e) => occursOn(e, selected));
  const upcoming = list
    .map((e) => ({ e, next: nextOccurrence(e, today) }))
    .filter((x) => x.next)
    .sort((a, b) => a.next.localeCompare(b.next))
    .slice(0, 8);

  const openNew = (preset = {}) =>
    setForm({ title: '', date: selected, type: 'otro', yearly: false, note: '', ...preset });

  const openPreset = (p) => {
    const t = parse(today);
    const thisYear = ymd(t.y, ...p.md.split('-').map(Number));
    const date = thisYear >= today ? thisYear : ymd(t.y + 1, ...p.md.split('-').map(Number));
    openNew({ title: p.title, date, type: 'festividad', yearly: true });
  };

  async function save(e) {
    e.preventDefault();
    setError('');
    const body = { title: form.title, date: form.date, type: form.type, yearly: form.yearly, note: form.note };
    try {
      const saved = form.id ? await api.patch(`/events/${form.id}`, body) : await api.post('/events', body);
      setEvents((prev) => (form.id ? prev.map((x) => (x.id === saved.id ? saved : x)) : [...prev, saved]));
      const { y, m } = parse(saved.date);
      setView({ y, m });
      setSelected(saved.date);
      setForm(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(ev) {
    if (!window.confirm(`¿Borrar “${ev.title}”?`)) return;
    try {
      await api.del(`/events/${ev.id}`);
      setEvents((prev) => prev.filter((x) => x.id !== ev.id));
    } catch (err) {
      setError(err.message);
    }
  }

  const monthName = first.toLocaleDateString('es', { month: 'long', year: 'numeric' });

  return (
    <section className="page narrow">
      <div className="page-head">
        <h1>Calendario</h1>
        <button className="btn" onClick={() => openNew()}><Plus size={18} /> Añadir fecha</button>
      </div>
      <p className="muted now-line">
        Hoy es {longDate(today)} · {now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
      </p>
      {error && <p className="notice">{error}</p>}

      <div className="card pad">
        <div className="cal-head">
          <button className="icon-btn" onClick={() => move(-1)} aria-label="Mes anterior"><ChevronLeft size={22} /></button>
          <strong className="cal-title">{monthName}</strong>
          <button className="icon-btn" onClick={() => move(1)} aria-label="Mes siguiente"><ChevronRight size={22} /></button>
          <button className="btn ghost small" onClick={goToday}>Hoy</button>
        </div>
        <div className="cal-grid" role="grid">
          {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {cells.map((day, i) => {
            if (!day) return <div key={`b${i}`} />;
            const key = ymd(view.y, view.m, day);
            const evs = list.filter((e) => occursOn(e, key));
            return (
              <button
                key={key}
                className={`cal-day ${key === today ? 'today' : ''} ${key === selected ? 'selected' : ''}`}
                onClick={() => setSelected(key)}
                aria-label={`${longDate(key)}${evs.length ? `, ${evs.length} fecha(s)` : ''}`}
              >
                <span>{day}</span>
                {evs.length > 0 && <span className="cal-dots">{evs.slice(0, 3).map((e) => <i key={e.id} />)}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card pad">
        <h2 className="h2 cap">{longDate(selected)}</h2>
        {events === null && !error && <p className="muted">Cargando…</p>}
        {events && dayEvents.length === 0 && <p className="muted">No hay fechas este día.</p>}
        {dayEvents.map((ev) => (
          <EventRow key={ev.id} ev={ev} sub={yearsLabel(ev, selected)} onEdit={() => setForm({ ...ev })} onDelete={() => remove(ev)} />
        ))}
        <button className="link" onClick={() => openNew()}>+ Añadir una fecha en este día</button>
      </div>

      <div className="card pad">
        <h2 className="h2">Próximas fechas</h2>
        {events && upcoming.length === 0 && <p className="muted">Todavía no hay fechas próximas. Añade un aniversario, un cumpleaños o una festividad.</p>}
        {upcoming.map(({ e, next }) => (
          <EventRow
            key={e.id}
            ev={e}
            badge={countdown(daysBetween(today, next))}
            sub={`${longDate(next)}${yearsLabel(e, next) ? ` · ${yearsLabel(e, next)}` : ''}`}
            onEdit={() => setForm({ ...e })}
            onDelete={() => remove(e)}
          />
        ))}
        <div className="chips presets">
          <span className="muted small">Añadir rápido:</span>
          {PRESETS.map((p) => (
            <button key={p.title} className="chip" onClick={() => openPreset(p)}>{p.title}</button>
          ))}
        </div>
      </div>

      {form && (
        <div className="lightbox" onClick={() => setForm(null)}>
          <form className="lightbox-box" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <button type="button" className="icon-btn close" onClick={() => setForm(null)} aria-label="Cerrar"><X size={22} /></button>
            <h2 className="h2">{form.id ? 'Editar fecha' : 'Nueva fecha'}</h2>
            <label>
              Título
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={80} placeholder="Nuestro aniversario" required autoFocus />
            </label>
            <label>
              Fecha
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </label>
            <label>
              Tipo
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, yearly: e.target.value !== 'otro' })}>
                {Object.entries(TYPES).map(([k, t]) => <option key={k} value={k}>{t.icon} {t.label}</option>)}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={form.yearly} onChange={(e) => setForm({ ...form, yearly: e.target.checked })} />
              Se repite cada año
            </label>
            <label>
              Nota (opcional)
              <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} />
            </label>
            <div className="row">
              <button className="btn">Guardar</button>
              <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancelar</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function EventRow({ ev, sub, badge, onEdit, onDelete }) {
  const t = TYPES[ev.type] || TYPES.otro;
  return (
    <div className="event-row">
      <span className="event-icon" aria-hidden="true">{t.icon}</span>
      <div className="event-text">
        <strong>{ev.title}</strong>
        <div className="muted small">{[t.label, sub].filter(Boolean).join(' · ')}</div>
        {ev.note && <div className="small">{ev.note}</div>}
      </div>
      {badge && <span className="badge">{badge}</span>}
      <button className="icon-btn" onClick={onEdit} aria-label="Editar"><Pencil size={17} /></button>
      <button className="icon-btn" onClick={onDelete} aria-label="Borrar"><Trash2 size={17} /></button>
    </div>
  );
}
