import { lazy, Suspense } from "react";
import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
} from "react-router-dom";

import PrivateRoute from "./components/PrivateRoute.jsx";
import AdminRoute from "./components/AdminRoute.jsx";
import LandingPage from "./pages/Landing.jsx";
import LoginPage from "./pages/Login.jsx";
import RegisterPage from "./pages/Register.jsx";
import AdminRequestPage from "./pages/AdminRequest.jsx";

/* Heavy authenticated routes are loaded on demand to keep first paint fast on mobile. */
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsers.jsx"));
const AdminRequestsPage = lazy(() => import("./pages/AdminRequests.jsx"));
const AdminBranchesPage = lazy(() => import("./pages/AdminBranches.jsx"));
const MaskDetectionTest = lazy(() => import("./pages/MaskDetectionTest.jsx"));
const PeopleCountTest = lazy(() => import("./pages/PeopleCountTest.jsx"));

function RouteFallback() {
  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center bg-[#020617] text-slate-300"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <svg className="h-8 w-8 animate-spin text-brand-sky" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <p className="text-sm text-slate-400">جاري التحميل…</p>
      </div>
    </div>
  );
}

const dashboardElement = (
  <PrivateRoute>
    <Suspense fallback={<RouteFallback />}>
      <Dashboard />
    </Suspense>
  </PrivateRoute>
);

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <RegisterPage /> },
  { path: "/register", element: <Navigate to="/signup" replace /> },

  { path: "/admin-request", element: <AdminRequestPage /> },

  {
    path: "/admin/users",
    element: (
      <AdminRoute>
        <Suspense fallback={<RouteFallback />}>
          <AdminUsersPage />
        </Suspense>
      </AdminRoute>
    ),
  },
  {
    path: "/admin/requests",
    element: (
      <AdminRoute>
        <Suspense fallback={<RouteFallback />}>
          <AdminRequestsPage />
        </Suspense>
      </AdminRoute>
    ),
  },
  {
    path: "/admin/branches",
    element: (
      <AdminRoute>
        <Suspense fallback={<RouteFallback />}>
          <AdminBranchesPage />
        </Suspense>
      </AdminRoute>
    ),
  },

  /* Staff dish workflow */
  { path: "/dashboard", element: dashboardElement },
  { path: "/dashboard/search", element: dashboardElement },
  { path: "/dashboard/records", element: dashboardElement },

  /* Supervisor / admin sections */
  { path: "/analytics", element: dashboardElement },
  { path: "/alerts", element: dashboardElement },
  { path: "/alerts/:id", element: dashboardElement },
  { path: "/cameras", element: dashboardElement },
  { path: "/cameras/:cameraId", element: dashboardElement },
  { path: "/reports", element: dashboardElement },
  { path: "/reports/:reportId", element: dashboardElement },
  { path: "/dish-reviews", element: dashboardElement },
  { path: "/employees", element: dashboardElement },
  { path: "/employees/:id", element: dashboardElement },
  { path: "/settings", element: dashboardElement },

  /* Legacy paths → clean URLs */
  { path: "/supervisor", element: <Navigate to="/analytics" replace /> },
  { path: "/monitoring", element: <Navigate to="/cameras" replace /> },

  {
    path: "/mask-check",
    element: (
      <PrivateRoute>
        <Suspense fallback={<RouteFallback />}>
          <MaskDetectionTest />
        </Suspense>
      </PrivateRoute>
    ),
  },
  {
    path: "/people-count-check",
    element: (
      <PrivateRoute>
        <Suspense fallback={<RouteFallback />}>
          <PeopleCountTest />
        </Suspense>
      </PrivateRoute>
    ),
  },

  { path: "/", element: <LandingPage /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
