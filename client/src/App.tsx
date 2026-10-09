import { Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home';
import { AdminLogin } from './pages/admin/AdminLogin';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { QuizEditor } from './pages/admin/QuizEditor';
import { SessionResults } from './pages/admin/SessionResults';
import { HostScreen } from './pages/admin/HostScreen';
import { RequireAdmin } from './auth/RequireAdmin';
import { Join } from './pages/participant/Join';
import { JoinShortLink } from './pages/participant/JoinShortLink';
import { Play } from './pages/participant/Play';
import { Results } from './pages/participant/Results';
import { RequireParticipant } from './auth/RequireParticipant';
import { AppTopBar } from './components/AppTopBar';
import { AdminExpiredBanner } from './components/admin/AdminExpiredBanner';

function App() {
  return (
    <>
      <AppTopBar />
      <AdminExpiredBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminDashboard />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/quizzes/:id"
          element={
            <RequireAdmin>
              <QuizEditor />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/sessions/:sessionId/results"
          element={
            <RequireAdmin>
              <SessionResults />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/sessions/:sessionId/host"
          element={
            <RequireAdmin>
              <HostScreen />
            </RequireAdmin>
          }
        />
        <Route path="/join" element={<Join />} />
        <Route path="/j/:code" element={<JoinShortLink />} />
        <Route
          path="/play"
          element={
            <RequireParticipant>
              <Play />
            </RequireParticipant>
          }
        />
        <Route
          path="/results"
          element={
            <RequireParticipant>
              <Results />
            </RequireParticipant>
          }
        />
      </Routes>
    </>
  );
}

export default App;
