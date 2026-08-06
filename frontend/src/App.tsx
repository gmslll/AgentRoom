import { Navigate, Route, Routes } from "react-router-dom";
import { useCurrentUser } from "./api/hooks";
import LoginPage from "./pages/LoginPage";
import RoomPage from "./pages/RoomPage";
import RoomsPage from "./pages/RoomsPage";
import { useTokenStore } from "./stores/tokenStore";

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
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/rooms" element={<RoomsPage />} />
      <Route path="/rooms/:roomId" element={<RoomPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
