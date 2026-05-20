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
import AdminUsersPage from "./pages/AdminUsers.jsx";
import AdminRequestsPage from "./pages/AdminRequests.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import MaskDetectionTest from "./pages/MaskDetectionTest.jsx";

/** Same dashboard shell for all authenticated app routes (paths drive section via Dashboard). */
const dashboardElement = (
  <PrivateRoute>
    <Dashboard />
  </PrivateRoute>
);

/**
 * Production SaaS URL structure — BrowserRouter (history API), no HashRouter.
 * Deploy SPA with fallback to index.html (Vite preview/dev handle this automatically).
 */
const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <RegisterPage /> },
  { path: "/register", element: <Navigate to="/signup" replace /> },

  { path: "/admin-request", element: <AdminRequestPage /> },

  {
    path: "/admin/users",
    element: (
      <AdminRoute>
        <AdminUsersPage />
      </AdminRoute>
    ),
  },
  {
    path: "/admin/requests",
    element: (
      <AdminRoute>
        <AdminRequestsPage />
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

  /* Mask detection test tool — requires login */
  {
    path: "/mask-check",
    element: (
      <PrivateRoute>
        <MaskDetectionTest />
      </PrivateRoute>
    ),
  },

  { path: "/", element: <LandingPage /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
