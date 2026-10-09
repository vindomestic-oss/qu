import { lazy, Suspense } from 'react';
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
import { RequireStaff } from './auth/RequireStaff';

// The grading panel is loaded on demand: the participants' iPads never download it.
const GraderEntry = lazy(() => import('./pages/grader/GraderEntry').then((m) => ({ default: m.GraderEntry })));
const GradingDashboard = lazy(() => import('./pages/grader/GradingDashboard').then((m) => ({ default: m.GradingDashboard })));
const ParticipantReview = lazy(() => import('./pages/grader/ParticipantReview').then((m) => ({ default: m.ParticipantReview })));
const WholeQuizReview = lazy(() => import('./pages/grader/WholeQuizReview').then((m) => ({ default: m.WholeQuizReview })));
import { AppTopBar } from './components/AppTopBar';
import { AdminExpiredBanner } from './components/admin/AdminExpiredBanner';

function App() {
  return (
    <>
      <AppTopBar />
      <AdminExpiredBanner />
      <Suspense fallback={null}>
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
        {/* Grading panel (wish 8): admins, and graders with a link for that one session. Not admin
            routes: they follow the interface language. */}
        <Route path="/g/:code" element={<GraderEntry />} />
        <Route path="/grade" element={<GraderEntry />} />
        <Route
          path="/grade/:sessionId"
          element={
            <RequireStaff>
              <GradingDashboard />
            </RequireStaff>
          }
        />
        <Route
          path="/grade/:sessionId/quiz"
          element={
            <RequireStaff>
              <WholeQuizReview />
            </RequireStaff>
          }
        />
        <Route
          path="/grade/:sessionId/participants/:participantId"
          element={
            <RequireStaff>
              <ParticipantReview />
            </RequireStaff>
          }
        />
      </Routes>
      </Suspense>
    </>
  );
}

export default App;
