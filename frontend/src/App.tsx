import { useEffect } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { getMe } from "./api/auth";
import { useCurrentUser } from "./api/hooks";
import { ToastHost } from "./components/ToastHost";
import { features } from "./config/features";
import LoginPage from "./pages/LoginPage";
import AccountPage from "./pages/AccountPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import RoomPage from "./pages/RoomPage";
import RoomsPage from "./pages/RoomsPage";
import { useTokenStore } from "./stores/tokenStore";
import { useToastStore } from "./stores/toastStore";

/** Unauthenticated → /login, authenticated → /rooms. */
function RootRedirect() {
  const token = useTokenStore((state) => state.token);
  return <Navigate to={token ? "/rooms" : "/login"} replace />;
}

export default function App() {
  // Validate the stored token once at startup so a reload restores the
  // session or bounces to /login when it expired.
  useCurrentUser();

  return (
    <>
      <OAuthSessionCapture />
      <EmailVerificationBanner />
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/rooms/:roomId" element={<RoomPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </>
  );
}

/**
 * Global reminder when email auth is on but the account is unverified.
 * Hidden on the login/auth flows and on the account page itself.
 */
function EmailVerificationBanner() {
  const user = useTokenStore((state) => state.user);
  const { pathname } = useLocation();
  const show =
    features.emailAuth &&
    Boolean(user) &&
    !user?.emailVerifiedAt &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/account") &&
    !pathname.startsWith("/forgot") &&
    !pathname.startsWith("/reset");
  if (!show) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs text-warning">
      <span>邮箱尚未验证,部分功能可能受限。</span>
      <Link to="/account" className="font-medium underline underline-offset-2 hover:text-text">
        前往验证
      </Link>
    </div>
  );
}

function OAuthSessionCapture() {  const navigate = useNavigate();
  const setSession = useTokenStore((state) => state.setSession);
  const pushToast = useToastStore((state) => state.push);

  useEffect(() => {
    if (!window.location.hash.startsWith("#")) return;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get("access_token");
    const expiresAt = fragment.get("expires_at");
    if (!accessToken || !expiresAt) return;

    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    let active = true;
    void getMe(accessToken)
      .then(({ user }) => {
        if (!active) return;
        setSession(accessToken, expiresAt, user);
        navigate("/rooms", { replace: true });
      })
      .catch(() => {
        if (!active) return;
        pushToast("OAuth 登录失败，请重新尝试", "error");
        navigate("/login", { replace: true });
      });
    return () => {
      active = false;
    };
  }, [navigate, pushToast, setSession]);

  return null;
}
