import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useRequestPasswordReset } from "../api/hooks";
import { AuthShell } from "../components/auth/AuthShell";
import { Icon } from "../components/ui/Icon";
import { features } from "../config/features";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const request = useRequestPasswordReset();
  if (!features.emailAuth) return <Navigate to="/login" replace />;

  return (
    <AuthShell>
      <p className="eyebrow mb-3">Credential recovery</p>
      <h2 className="text-3xl font-extrabold tracking-[-0.045em] text-text">
        找回密码
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        输入邮箱后，我们会发送一次性重置码。无论账号是否存在，响应都保持一致。
      </p>
      {request.isSuccess ? (
        <div className="panel-soft mt-8 p-5">
          <p className="font-semibold text-primary">重置邮件已受理</p>
          <p className="mt-2 text-sm text-muted">
            请检查邮箱，然后前往重置页面输入验证码。
          </p>
          <Link
            to={`/reset-password?email=${encodeURIComponent(email)}`}
            className="button-primary mt-5 h-11 px-4"
          >
            输入重置码
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      ) : (
        <form
          className="mt-8 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim()) request.mutate(email.trim());
          }}
        >
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-muted">
              账号邮箱
            </span>
            <input
              className="field-control h-11 px-3"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          {request.error && (
            <p className="text-xs text-danger">
              {request.error instanceof ApiError
                ? request.error.message
                : "发送失败，请稍后重试"}
            </p>
          )}
          <button
            className="button-primary h-12 w-full px-5"
            disabled={request.isPending || !email.trim()}
          >
            {request.isPending ? "发送中…" : "发送重置码"}
          </button>
        </form>
      )}
      <Link
        to="/login"
        className="mt-6 inline-flex items-center gap-2 text-xs text-muted hover:text-text"
      >
        ← 返回登录
      </Link>
    </AuthShell>
  );
}
