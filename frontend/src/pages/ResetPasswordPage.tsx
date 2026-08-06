import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useResetPassword } from "../api/hooks";
import { AuthShell } from "../components/auth/AuthShell";
import { features } from "../config/features";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const reset = useResetPassword();
  if (!features.emailAuth) return <Navigate to="/login" replace />;

  return (
    <AuthShell>
      <p className="eyebrow mb-3">Set new credential</p>
      <h2 className="text-3xl font-extrabold tracking-[-0.045em] text-text">
        设置新密码
      </h2>
      <p className="mt-2 text-sm text-muted">
        成功后，其他已登录 session 会被撤销。
      </p>
      {reset.isSuccess ? (
        <div className="panel-soft mt-8 p-5">
          <p className="font-semibold text-primary">密码已重置</p>
          <Link to="/login" className="button-primary mt-5 h-11 px-5">
            重新登录
          </Link>
        </div>
      ) : (
        <form
          className="mt-8 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            reset.mutate({
              email: email.trim(),
              code: code.trim(),
              newPassword: password,
            });
          }}
        >
          <AuthInput
            label="邮箱"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
          />
          <AuthInput
            label="重置码"
            autoComplete="one-time-code"
            value={code}
            onChange={setCode}
          />
          <AuthInput
            label="新密码"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
          />
          {reset.error && (
            <p className="text-xs text-danger">
              {reset.error instanceof ApiError
                ? reset.error.message
                : "重置失败，请重试"}
            </p>
          )}
          <button
            className="button-primary h-12 w-full px-5"
            disabled={
              reset.isPending ||
              !email.trim() ||
              !code.trim() ||
              password.length < 8
            }
          >
            {reset.isPending ? "提交中…" : "更新密码"}
          </button>
        </form>
      )}
      <Link
        to="/login"
        className="mt-6 inline-block text-xs text-muted hover:text-text"
      >
        ← 返回登录
      </Link>
    </AuthShell>
  );
}

function AuthInput({
  label,
  type = "text",
  autoComplete,
  value,
  onChange,
}: {
  label: string;
  type?: string;
  autoComplete?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold text-muted">
        {label}
      </span>
      <input
        className="field-control h-11 px-3"
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </label>
  );
}
