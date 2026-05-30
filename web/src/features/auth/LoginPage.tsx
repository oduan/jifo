import { FormEvent, useState } from 'react';

import { createApiClient } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Field, TextInput } from '../../shared/ui/Input';
import { submitAuth } from './api';
import { authStore, AuthUser } from './authStore';

export type AuthMode = 'login' | 'register';

export type LoginPayload = {
  email: string;
  password: string;
  mode: AuthMode;
};

export type LoginResult = {
  accessToken: string;
  refreshToken?: string;
  user?: AuthUser;
};

type LoginPageProps = {
  onSubmit?: (payload: LoginPayload) => Promise<LoginResult>;
  onSuccess?: (result: LoginResult) => void;
};

const defaultClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api',
  getAccessToken: authStore.getAccessToken
});

const defaultSubmit = async (payload: LoginPayload): Promise<LoginResult> => submitAuth(defaultClient, payload);

export function LoginPage({ onSubmit = defaultSubmit, onSuccess }: LoginPageProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await onSubmit({ email, password, mode });
      onSuccess?.(result);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : mode === 'login' ? '登录失败，请检查邮箱和密码。' : '注册失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel = mode === 'login' ? '登录' : '创建账号';
  const loadingLabel = mode === 'login' ? '登录中…' : '注册中…';

  return (
    <main className="auth-page">
      <section className="auth-hero" aria-labelledby="auth-title">
        <div>
          <p className="auth-kicker">Jifo Notes</p>
          <h1 id="auth-title" className="auth-title">
            轻量记录，安静回看
          </h1>
          <p className="auth-subtitle">
            像 Flomo 一样快速写下想法，用嵌套标签、热力图和离线同步，把日常片段沉淀成可以回看的知识流。
          </p>
        </div>

        <div className="auth-feature-grid" aria-label="Jifo 核心能力">
          <div className="auth-feature">
            <strong>图文块笔记</strong>
            <span>文字、分割线和图片在同一个轻量编辑器里完成。</span>
          </div>
          <div className="auth-feature">
            <strong>嵌套标签</strong>
            <span>用 #电视剧/电视剧1 这样的路径自然组织内容。</span>
          </div>
          <div className="auth-feature">
            <strong>离线优先</strong>
            <span>断网时先保存到本地，恢复网络后自动同步。</span>
          </div>
        </div>
      </section>

      <section className="auth-card" aria-label="认证表单">
        <div className="auth-tabs" aria-label="认证模式">
          <button className="auth-tab" type="button" aria-label="登录模式" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>
            登录
          </button>
          <button className="auth-tab" type="button" aria-label="注册模式" aria-pressed={mode === 'register'} onClick={() => setMode('register')}>
            注册
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <Field label="Email">
            <TextInput
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
              autoComplete="email"
              spellCheck={false}
              placeholder="user@example.com…"
            />
          </Field>

          <Field label="Password">
            <TextInput
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="至少 8 位…"
            />
          </Field>

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? loadingLabel : submitLabel}
          </Button>
        </form>
      </section>
    </main>
  );
}
