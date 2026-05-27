import { afterEach, describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { authStore } from '../features/auth/authStore';
import { App } from './App';

afterEach(() => {
  authStore.clear();
});

describe('App', () => {
  test('未认证显示登录页，已认证显示 NotesPage', () => {
    const { rerender } = render(<App />);
    expect(screen.getByRole('heading', { name: 'Jifo 登录' })).toBeInTheDocument();

    authStore.setAccessToken('demo-token');
    rerender(<App />);

    expect(screen.getByText('全部笔记')).toBeInTheDocument();
    expect(screen.queryByText('Jifo 主界面（占位）')).not.toBeInTheDocument();
  });
});
