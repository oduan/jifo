import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createApiClient } from '../../shared/api/client';
import { LoginPage } from './LoginPage';
import { authStore, migrateLegacyAuthStorage } from './authStore';

afterEach(() => {
  authStore.clear();
});

describe('api client', () => {
  test('request 会自动携带 Authorization header', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      getAccessToken: () => 'token-abc',
      fetchImpl
    });

    await client.request<{ ok: boolean }>('/me');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const firstCallHeaders = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(firstCallHeaders.get('Authorization')).toBe('Bearer token-abc');
  });

  test('401 时会触发 refresh 并重试请求', async () => {
    let accessToken = 'expired-token';
    const refreshAccessToken = vi.fn(async () => {
      accessToken = 'fresh-token';
      return accessToken;
    });

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      getAccessToken: () => accessToken,
      refreshAccessToken,
      fetchImpl
    });

    const result = await client.request<{ ok: boolean }>('/notes');

    expect(result.ok).toBe(true);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    const retriedHeaders = new Headers(fetchImpl.mock.calls[1]?.[1]?.headers);
    expect(retriedHeaders.get('Authorization')).toBe('Bearer fresh-token');
  });

  test('refresh 返回的新 token 会直接用于重试请求', async () => {
    const refreshAccessToken = vi.fn(async () => 'fresh-token');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      getAccessToken: () => 'expired-token',
      refreshAccessToken,
      fetchImpl
    });

    await client.request<{ ok: boolean }>('/notes');

    const retriedHeaders = new Headers(fetchImpl.mock.calls[1]?.[1]?.headers);
    expect(retriedHeaders.get('Authorization')).toBe('Bearer fresh-token');
  });
});

describe('authStore', () => {
  test('getState 返回状态副本，外部修改不会污染 store', () => {
    authStore.setAccessToken('token-1');

    const snapshot = authStore.getState();
    snapshot.accessToken = 'tampered-token';

    expect(authStore.getState().accessToken).toBe('token-1');
    authStore.clear();
  });

  test('token 只存内存，localStorage 只保留非敏感 user', () => {
    authStore.setSession({ accessToken: 'token-1', user: { id: 'u1', email: 'a@b.c' } });

    const raw = localStorage.getItem('jifo.auth');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('token-1');
    expect(JSON.parse(raw ?? '{}')).toEqual({ user: { id: 'u1', email: 'a@b.c' } });

    // setAccessToken 同样只改内存,不触碰 localStorage
    authStore.setAccessToken('token-2');
    expect(localStorage.getItem('jifo.auth')).not.toContain('token-2');

    authStore.clear();
    expect(localStorage.getItem('jifo.auth')).toBeNull();
  });

  test('migrateLegacyAuthStorage 剥离旧版本明文 token，只保留 user', () => {
    localStorage.setItem(
      'jifo.auth',
      JSON.stringify({ accessToken: 'old-access', refreshToken: 'old-refresh', user: { id: 'u1', email: 'a@b.c' } })
    );

    migrateLegacyAuthStorage();

    const raw = localStorage.getItem('jifo.auth');
    expect(raw).not.toContain('old-access');
    expect(raw).not.toContain('old-refresh');
    expect(JSON.parse(raw ?? '{}')).toEqual({ user: { id: 'u1', email: 'a@b.c' } });
  });

  test('migrateLegacyAuthStorage 对没有有效 user 的旧数据整键删除', () => {
    localStorage.setItem('jifo.auth', 'not-json');
    migrateLegacyAuthStorage();
    expect(localStorage.getItem('jifo.auth')).toBeNull();

    localStorage.setItem('jifo.auth', JSON.stringify({ accessToken: 'a', refreshToken: 'r' }));
    migrateLegacyAuthStorage();
    expect(localStorage.getItem('jifo.auth')).toBeNull();

    localStorage.setItem('jifo.auth', JSON.stringify({ user: { id: 'u1', email: 'a@b.c' } }));
    migrateLegacyAuthStorage();
    // 已经是干净数据时保持原样
    expect(JSON.parse(localStorage.getItem('jifo.auth') ?? '{}')).toEqual({ user: { id: 'u1', email: 'a@b.c' } });
  });
});

describe('LoginPage', () => {
  test('呈现温暖克制的产品化登录界面并支持切换注册模式', async () => {
    const user = userEvent.setup();

    render(<LoginPage onSubmit={vi.fn()} />);

    expect(screen.getByRole('main')).toHaveClass('auth-page');
    expect(screen.getByText('轻量记录，安静回看')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录模式' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '注册模式' }));

    expect(screen.getByRole('button', { name: '注册模式' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '创建账号' })).toBeInTheDocument();
  });

  test('填写 email/password 后可提交并调用成功回调', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {
      return { accessToken: 'token-1' };
    });
    const onSuccess = vi.fn();

    render(<LoginPage onSubmit={onSubmit} onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');

    expect(screen.queryByLabelText('Device Name')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'password123',
        mode: 'login'
      });
      expect(onSuccess).toHaveBeenCalledWith({ accessToken: 'token-1' });
    });
  });

  test('提交失败时显示错误提示', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {
      throw new Error('邮箱或密码错误');
    });

    render(<LoginPage onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码错误');
  });

  test('提交中会禁用按钮避免重复提交', async () => {
    const user = userEvent.setup();
    let resolveSubmit: (value: { accessToken: string }) => void = () => undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<{ accessToken: string }>((resolve) => {
          resolveSubmit = resolve;
        })
    );

    render(<LoginPage onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    const submittingButton = await screen.findByRole('button', { name: '登录中…' });
    expect(submittingButton).toBeDisabled();

    await user.click(submittingButton);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    resolveSubmit({ accessToken: 'token-1' });
  });
});
