import { FormEvent, useState } from 'react';

export type LoginPayload = {
  email: string;
  password: string;
  deviceName: string;
};

export type LoginResult = {
  accessToken: string;
};

type LoginPageProps = {
  onSubmit?: (payload: LoginPayload) => Promise<LoginResult>;
  onSuccess?: (result: LoginResult) => void;
};

const defaultSubmit = async (_payload: LoginPayload): Promise<LoginResult> => {
  return { accessToken: 'demo-token' };
};

export function LoginPage({ onSubmit = defaultSubmit, onSuccess }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await onSubmit({ email, password, deviceName });
      onSuccess?.(result);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main style={{ maxWidth: 420, margin: '48px auto', fontFamily: 'system-ui' }}>
      <h1>Jifo 登录</h1>
      <p>先完成认证，主笔记布局将在 Task 10 实现。</p>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <label>
          <div>Email</div>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
            autoComplete="email"
          />
        </label>

        <label>
          <div>Password</div>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
            autoComplete="current-password"
          />
        </label>

        <label>
          <div>Device Name</div>
          <input
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
            type="text"
            required
            placeholder="My Laptop"
          />
        </label>

        {error ? <p role="alert">{error}</p> : null}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? '登录中...' : '登录'}
        </button>
      </form>
    </main>
  );
}
