import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { ApiError } from "../api/client";
import { oauthAuthorizeUrl } from "../api/auth";
import { useLogin, useRegister } from "../api/hooks";
import type { OAuthProvider } from "../api/types";
import { AuthShell } from "../components/auth/AuthShell";
import { Icon } from "../components/ui/Icon";
import { features } from "../config/features";
import { useToastStore } from "../stores/toastStore";
import { useTokenStore } from "../stores/tokenStore";

const loginSchema = z.object({
  email: z.string().trim().email("请输入有效的邮箱地址"),
  password: z.string().min(8, "密码至少 8 位").max(128, "密码最多 128 位"),
});

const registerSchema = loginSchema.extend({
  displayName: z
    .string()
    .trim()
    .min(1, "请输入昵称")
    .max(64, "昵称最多 64 个字符"),
});

type RegisterValues = z.infer<typeof registerSchema>;
type Mode = "login" | "register";

export default function LoginPage() {
  const token = useTokenStore((state) => state.token);
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const isRegister = mode === "register";
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const mutation = isRegister ? registerMutation : loginMutation;
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<RegisterValues>({
    resolver: zodResolver(isRegister ? registerSchema : loginSchema),
    defaultValues: { email: "", password: "", displayName: "" },
  });

  if (token) return <Navigate to="/rooms" replace />;

  const switchMode = (next: Mode) => {
    setMode(next);
    reset({ email: "", password: "", displayName: "" });
    mutation.reset();
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isRegister) {
        await registerMutation.mutateAsync(values);
        if (features.emailAuth) {
          useToastStore
            .getState()
            .push(
              "账号已创建。验证码已发送,请到「账号设置」完成邮箱验证。",
              "info",
            );
        }
      } else {
        await loginMutation.mutateAsync({
          email: values.email,
          password: values.password,
        });
      }
      navigate("/rooms", { replace: true });
    } catch {
      // Mutation state renders the error.
    }
  });

  return (
    <AuthShell>
      <p className="eyebrow mb-3">Account uplink</p>
      <h2 className="text-3xl font-extrabold tracking-[-0.045em] text-text">
        {isRegister ? "建立你的调度身份" : "重新接入协作网络"}
      </h2>
      <p className="mt-2 text-sm text-muted">
        {isRegister
          ? "创建账号后即可建立房间并连接本地 Agent。"
          : "使用账号继续管理房间、任务和 Agent 权限。"}
      </p>

      <div className="mt-8 grid grid-cols-2 border-b border-border text-sm">
        {(["login", "register"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => switchMode(item)}
            className={`relative px-4 py-3 font-semibold transition-colors ${
              mode === item ? "text-primary" : "text-muted hover:text-text"
            }`}
          >
            {item === "login" ? "登录" : "注册"}
            {mode === item && (
              <span className="absolute inset-x-0 bottom-[-1px] h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="mt-7 space-y-5" noValidate>
        {isRegister && (
          <Field label="显示名称" error={errors.displayName?.message}>
            <input
              className="field-control h-11 px-3"
              autoComplete="nickname"
              placeholder="例如：后端调度"
              {...register("displayName")}
            />
          </Field>
        )}
        <Field label="邮箱" error={errors.email?.message}>
          <input
            className="field-control h-11 px-3"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            {...register("email")}
          />
        </Field>
        <Field
          label="密码"
          error={errors.password?.message}
          trailing={
            !isRegister && features.emailAuth ? (
              <Link
                to="/forgot-password"
                className="text-[11px] text-primary hover:underline"
              >
                忘记密码
              </Link>
            ) : null
          }
        >
          <input
            className="field-control h-11 px-3"
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            placeholder="至少 8 位"
            {...register("password")}
          />
        </Field>

        {mutation.error && (
          <p
            role="alert"
            className="border-l-2 border-danger bg-danger/5 px-3 py-2 text-xs text-danger"
          >
            {errorText(mutation.error)}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="button-primary h-12 w-full px-5"
        >
          {mutation.isPending
            ? "建立连接中…"
            : isRegister
              ? "创建账号"
              : "进入 AgentRoom"}
          {!mutation.isPending && <Icon name="arrow" size={17} />}
        </button>
      </form>

      {(features.googleOAuth || features.githubOAuth) && (
        <div className="mt-7">
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-muted">
            <span className="h-px flex-1 bg-border" />
            其他登录方式
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {features.googleOAuth && (
              <OAuthButton provider="google" label="Google" />
            )}
            {features.githubOAuth && (
              <OAuthButton provider="github" label="GitHub" />
            )}
          </div>
        </div>
      )}
    </AuthShell>
  );
}

function OAuthButton({
  provider,
  label,
}: {
  provider: OAuthProvider;
  label: string;
}) {
  return (
    <a
      href={oauthAuthorizeUrl(provider)}
      className="button-secondary h-11 px-4 text-sm font-semibold"
    >
      <Icon name={provider === "github" ? "terminal" : "globe"} size={16} />
      使用 {label}
    </a>
  );
}

function Field({
  label,
  error,
  trailing,
  children,
}: {
  label: string;
  error?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between text-xs font-semibold text-muted">
        {label}
        {trailing}
      </span>
      {children}
      {error && (
        <span className="mt-1.5 block text-xs text-danger">{error}</span>
      )}
    </label>
  );
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "尝试过于频繁，请稍后再试";
    if (error.code === "EMAIL_ALREADY_REGISTERED")
      return "该邮箱已注册，请直接登录";
    return error.message;
  }
  return "请求失败，请检查网络后重试";
}
