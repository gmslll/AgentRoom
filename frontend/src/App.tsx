import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { getMe } from "./api/auth";
import { useCurrentUser } from "./api/hooks";
import { ToastHost } from "./components/ToastHost";
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

function OAuthSessionCapture() {
  const navigate = useNavigate();
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
