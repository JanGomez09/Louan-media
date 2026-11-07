import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { api, uploadToAlbum } from '../api';
import { useApp } from '../AppContext';
import { Media } from '../components/Media';
import { fmtDate } from './Dashboard';

// Álbum: todas las fotos y videos de la app. Desde aquí también se publican en Inicio.
export default function Album() {
  const { profile, getPerson } = useApp();
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const input = useRef(null);

  useEffect(() => {
    api.get('/media').then(setItems).catch((e) => setError(e.message));
  }, []);

  const shown = (items || []).filter((i) =>
    filter === 'all' ? true : filter === 'mine' ? i.owner_uid === profile.uid : i.owner_uid !== profile.uid
  );

  function close() {
    setOpen(null);
    setPublishing(false);
    setCaption('');
    setModalError('');
  }

  async function onFiles(e) {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    setError('');
    try {
      const added = await uploadToAlbum(files, (n, total) => setStatus(`Subiendo ${n} de ${total}…`));
      setItems((prev) => [...added.reverse(), ...prev]);
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus('');
    }
  }

  async function remove(item) {
    if (!window.confirm('¿Borrar del álbum? También se quitará de Inicio si estaba publicada.')) return;
    try {
      await api.del(`/media/${item.id}`);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      close();
    } catch (err) {
      setModalError(err.message);
    }
  }

  async function publish() {
    setBusy(true);
    setModalError('');
    try {
      await api.post('/posts', { mediaId: open.id, caption });
      navigate('/');
    } catch (err) {
      setModalError(err.message);
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <div className="page-head">
        <h1>Álbum de pareja</h1>
        <button className="btn" onClick={() => input.current.click()} disabled={!!status}>
          <Plus size={18} /> Agregar
        </button>
        <input ref={input} type="file" accept="image/*,video/*" multiple hidden onChange={onFiles} />
      </div>
      <div className="chips" role="tablist">
        {[['all', 'Todas'], ['mine', 'Mías'], ['theirs', 'De mi pareja']].map(([k, label]) => (
          <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      {status && <p className="muted">{status}</p>}
      {error && <p className="notice">{error}</p>}
      {items === null && !error && <p className="muted">Cargando álbum…</p>}
      {items?.length === 0 && <div className="empty"><p>El álbum está vacío. Agrega la primera foto o video.</p></div>}
      {items?.length > 0 && shown.length === 0 && <div className="empty"><p>No hay fotos ni videos en esta vista.</p></div>}
      <div className="grid">
        {shown.map((it) => (
          <button key={it.id} className="tile" onClick={() => setOpen(it)} aria-label="Abrir">
            <Media id={it.id} mime={it.mime} className="tile-media" />
          </button>
        ))}
      </div>

      {open && (
        <div className="lightbox" onClick={close}>
          <div className="lightbox-box" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn close" onClick={close} aria-label="Cerrar"><X size={22} /></button>
            <Media id={open.id} mime={open.mime} className="lightbox-media" controls />
            <p className="muted small">Subida por {getPerson(open.owner_uid).username} · {fmtDate(open.created_at)}</p>
            {modalError && <p className="notice">{modalError}</p>}
            {publishing ? (
              <div className="publish-panel">
                <label>
                  Descripción
                  <textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} placeholder="Cuenta algo de este momento" autoFocus />
                </label>
                <div className="row">
                  <button className="btn" onClick={publish} disabled={busy}>{busy ? 'Publicando…' : 'Publicar en Inicio'}</button>
                  <button className="btn ghost" onClick={() => setPublishing(false)} disabled={busy}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="row">
                <button className="btn" onClick={() => setPublishing(true)}>Publicar</button>
                {open.owner_uid === profile.uid && (
                  <button className="btn ghost" onClick={() => remove(open)}>Borrar</button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
