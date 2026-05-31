import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SettingsPopover } from './SettingsPopover';

describe('SettingsPopover', () => {
  test('点击用户名触发器会打开设置面板', async () => {
    const user = userEvent.setup();

    render(<SettingsPopover userName="oisin" onLogout={vi.fn()} />);

    expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument();

    const trigger = screen.getByRole('button', { name: 'oisin 设置菜单' });
    expect(trigger).toHaveTextContent('oisin');
    expect(trigger).toHaveTextContent('▾');

    await user.click(trigger);

    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();
  });

  test('点击外部区域后关闭设置面板', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <SettingsPopover userName="oisin" onLogout={vi.fn()} />
        <button type="button">外部按钮</button>
      </div>
    );

    await user.click(screen.getByRole('button', { name: 'oisin 设置菜单' }));
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '外部按钮' }));

    expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument();
  });

  test('按 Escape 后关闭设置面板', async () => {
    const user = userEvent.setup();

    render(<SettingsPopover userName="oisin" onLogout={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'oisin 设置菜单' }));
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument();
  });

  test('焦点移到外部元素后关闭设置面板', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <SettingsPopover userName="oisin" onLogout={vi.fn()} />
        <button type="button">外部按钮</button>
      </div>
    );

    await user.click(screen.getByRole('button', { name: 'oisin 设置菜单' }));
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();

    await user.tab();
    await user.tab();

    expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument();
  });
});
