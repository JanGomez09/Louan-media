import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../AppContext';

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const plain = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const letterOf = (artist) => {
  const c = plain(artist.trim()).charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};

export default function Poetry() {
  const { profile, getPerson } = useApp();
  const [quotes, setQuotes] = useState(null);
  const [form, setForm] = useState({ artist: '', song: '', quote: '' });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/quotes').then(setQuotes).catch((e) => setError(e.message));
  }, []);

  // Orden alfabético por artista y, dentro de cada artista, por canción
  const groups = useMemo(() => {
    const q = plain(search.trim());
    const filtered = (quotes || []).filter((x) => !q || plain(`${x.artist} ${x.song} ${x.quote}`).includes(q));
    filtered.sort((a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.song, b.song) || collator.compare(a.quote, b.quote));
    const map = new Map();
    for (const x of filtered) {
      const l = letterOf(x.artist);
      if (!map.has(l)) map.set(l, []);
      map.get(l).push(x);
    }
    return [...map.entries()];
  }, [quotes, search]);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await api.post('/quotes', form);
      setQuotes((prev) => [...prev, created]);
      setForm({ artist: '', song: '', quote: '' });
      setSearch('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(q) {
    if (!window.confirm('¿Borrar esta cita?')) return;
    try {
      await api.del(`/quotes/${q.id}`);
      setQuotes((prev) => prev.filter((x) => x.id !== q.id));
    } catch (err) {
      setError(err.message);
    }
  }

  const jump = (l) => document.getElementById(`letra-${l === '#' ? 'otros' : l}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <section className="page narrow">
      <h1>Diccionario de poesía sonora</h1>
      <p className="muted">Las frases de canciones que son nuestras, en orden alfabético por artista.</p>

      <form className="card pad" onSubmit={add}>
        <div className="two-cols">
          <label>
            Artista
            <input value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} maxLength={100} required />
          </label>
          <label>
            Canción
            <input value={form.song} onChange={(e) => setForm({ ...form, song: e.target.value })} maxLength={150} required />
          </label>
        </div>
        <label>
          Cita
          <textarea rows={3} value={form.quote} onChange={(e) => setForm({ ...form, quote: e.target.value })} maxLength={1000} required />
        </label>
        {error && <p className="notice">{error}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Añadiendo…' : 'Añadir al diccionario'}</button>
      </form>

      {quotes === null && !error && <p className="muted">Cargando…</p>}
      {quotes?.length === 0 && <div className="empty"><p>Todavía no hay citas. Añade la primera.</p></div>}

      {quotes?.length > 0 && (
        <>
          <input className="search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por artista, canción o frase" aria-label="Buscar" />
          <div className="letters">
            {groups.map(([l]) => (
              <button key={l} className="chip" onClick={() => jump(l)}>{l}</button>
            ))}
          </div>
          <p className="muted small">{quotes.length} {quotes.length === 1 ? 'cita' : 'citas'}</p>
          {groups.length === 0 && <p className="muted">No hay resultados.</p>}
        </>
      )}

      {groups.map(([l, items]) => (
        <div key={l}>
          <h2 className="letter" id={`letra-${l === '#' ? 'otros' : l}`}>{l}</h2>
          {items.map((q) => (
            <article key={q.id} className="card quote">
              <blockquote>{q.quote}</blockquote>
              <div className="quote-foot">
                <div>
                  <strong>{q.artist}</strong> · <em>{q.song}</em>
                  <div className="muted small">Añadida por {getPerson(q.added_by).username}</div>
                </div>
                {q.added_by === profile.uid && (
                  <button className="icon-btn" onClick={() => remove(q)} aria-label="Borrar cita"><Trash2 size={18} /></button>
                )}
              </div>
            </article>
          ))}
        </div>
      ))}
    </section>
  );
}
