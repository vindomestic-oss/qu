import { Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home';
import { AdminLogin } from './pages/admin/AdminLogin';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { QuizEditor } from './pages/admin/QuizEditor';
import { SessionResults } from './pages/admin/SessionResults';
import { RequireAdmin } from './auth/RequireAdmin';
import { Join } from './pages/participant/Join';
import { Play } from './pages/participant/Play';
import { Results } from './pages/participant/Results';
import { RequireParticipant } from './auth/RequireParticipant';

function App() {
  return (
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
      <Route path="/join" element={<Join />} />
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
  );
}

export default App;
