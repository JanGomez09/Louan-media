import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './AppContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Chat from './pages/Chat';
import Album from './pages/Album';
import Settings from './pages/Settings';
import Calendar from './pages/Calendar';
import Poetry from './pages/Poetry';

function Protected() {
  const { user } = useApp();
  if (user === undefined) return <div className="center-screen">Cargando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

function LoginRoute() {
  const { user } = useApp();
  if (user === undefined) return <div className="center-screen">Cargando…</div>;
  return user ? <Navigate to="/" replace /> : <Login />;
}

export default function App() {
  return (
    <HashRouter>
      <AppProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<Protected />}>
            <Route index element={<Dashboard />} />
            <Route path="chat" element={<Chat />} />
            <Route path="album" element={<Album />} />
            <Route path="publicar" element={<Navigate to="/album" replace />} />
            <Route path="calendario" element={<Calendar />} />
            <Route path="poesia" element={<Poetry />} />
            <Route path="config" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppProvider>
    </HashRouter>
  );
}
