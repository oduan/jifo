import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createApiClient } from '../../shared/api/client';
import { LoginPage } from './LoginPage';
import { authStore } from './authStore';

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
