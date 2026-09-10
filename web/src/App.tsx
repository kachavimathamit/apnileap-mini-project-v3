import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './session';
import { Loading } from './components/ui';
import { Shell } from './Shell';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { RegisterStudentPage } from './pages/RegisterStudentPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { InstitutePage } from './pages/InstitutePage';
import { DepartmentPage } from './pages/DepartmentPage';
import { ProjectPage } from './pages/ProjectPage';
import { WeeklyReportPage } from './pages/WeeklyReportPage';
import { PendingReviewsPage } from './pages/PendingReviewsPage';
import { RoleRequestsPage } from './pages/RoleRequestsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { AdminPage } from './pages/AdminPage';
import { AuditPage } from './pages/AuditPage';

export function App() {
  const { session, loading } = useSession();

  if (loading) return <Loading what="your portal" />;

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/register-student" element={<RegisterStudentPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // A forced password change blocks everything else until it is completed.
  if (session.user.mustChangePassword) {
    return (
      <Routes>
        <Route path="*" element={<ChangePasswordPage forced />} />
      </Routes>
    );
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<PortfolioPage />} />
        <Route path="/institutes/:instituteId" element={<InstitutePage />} />
        <Route path="/departments/:departmentId" element={<DepartmentPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/reports/weekly" element={<WeeklyReportPage />} />
        <Route path="/reviews/pending" element={<PendingReviewsPage />} />
        <Route path="/admin/role-requests" element={<RoleRequestsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/account/password" element={<ChangePasswordPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/audit" element={<AuditPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
