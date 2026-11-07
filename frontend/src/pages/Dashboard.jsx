import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../AppContext';
import { Avatar, Media } from '../components/Media';

export const fmtDate = (d) =>
  new Date(d).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });

export default function Dashboard() {
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/posts').then(setPosts).catch((e) => setError(e.message));
  }, []);

  const patch = (id, fn) => setPosts((ps) => ps.map((p) => (p.id === id ? fn(p) : p)));

  return (
    <section className="page narrow">
      <h1>Inicio</h1>
      {error && <p className="notice">{error}</p>}
      {posts === null && !error && <p className="muted">Cargando publicaciones…</p>}
      {posts?.length === 0 && (
        <div className="empty">
          <p>Todavía no hay publicaciones.</p>
          <Link className="btn" to="/album">Elegir una foto para publicar</Link>
        </div>
      )}
      {posts?.map((p) => (
        <PostCard
          key={p.id}
          post={p}
          onPatch={(fn) => patch(p.id, fn)}
          onDelete={() => setPosts((ps) => ps.filter((x) => x.id !== p.id))}
        />
      ))}
    </section>
  );
}

function PostCard({ post, onPatch, onDelete }) {
  const { profile, getPerson } = useApp();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const author = getPerson(post.author_uid);

  async function like() {
    onPatch((p) => ({ ...p, liked: !p.liked, likes: p.likes + (p.liked ? -1 : 1) }));
    try {
      await api.post(`/posts/${post.id}/like`);
    } catch (e) {
      setError(e.message);
      onPatch((p) => ({ ...p, liked: !p.liked, likes: p.likes + (p.liked ? -1 : 1) }));
    }
  }

  async function comment(e) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const c = await api.post(`/posts/${post.id}/comments`, { text });
      onPatch((p) => ({ ...p, comments: [...p.comments, c] }));
      setText('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!window.confirm('¿Borrar esta publicación? La foto seguirá en el álbum.')) return;
    try {
      await api.del(`/posts/${post.id}`);
      onDelete();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <article className="card post">
      <header className="post-head">
        <Avatar person={author} size={38} />
        <div>
          <strong>{author.username}</strong>
          <div className="muted small">{fmtDate(post.created_at)}</div>
        </div>
        {post.author_uid === profile.uid && (
          <button className="icon-btn push" onClick={remove} aria-label="Borrar publicación">
            <Trash2 size={18} />
          </button>
        )}
      </header>
      <Media id={post.media_id} mime={post.mime} className="post-media" controls />
      <div className="post-body">
        <button className={`like ${post.liked ? 'on' : ''}`} onClick={like} aria-pressed={post.liked}>
          <Heart size={22} fill={post.liked ? 'currentColor' : 'none'} />
          <span>{post.likes}</span>
        </button>
        {post.caption && (
          <p><strong>{author.username}</strong> {post.caption}</p>
        )}
        {post.comments.map((c) => (
          <p key={c.id} className="comment"><strong>{getPerson(c.uid).username}</strong> {c.text}</p>
        ))}
        {error && <p className="notice">{error}</p>}
        <form className="row" onSubmit={comment}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe un comentario" maxLength={1000} />
          <button className="btn small" disabled={!text.trim()}>Comentar</button>
        </form>
      </div>
    </article>
  );
}
