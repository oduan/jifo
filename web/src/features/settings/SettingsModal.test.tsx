import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SettingsModal } from './SettingsModal';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SettingsModal', () => {
  test('展示密钥设置界面和已生成密钥列表', () => {
    render(
      <SettingsModal
        open
        accessKeys={[{ id: 'k1', label: 'CLI', maskedKey: 'jifo_abcd••••••vwxyz', createdAt: '2026-05-31T00:00:00Z' }]}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '密钥' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('CLI')).toBeInTheDocument();
    expect(screen.getByText('jifo_abcd••••••vwxyz')).toBeInTheDocument();
  });

  test('新建密钥后只在结果框显示完整 secret', async () => {
    const user = userEvent.setup();
    const onCreateAccessKey = vi.fn(async () => ({
      item: { id: 'k1', label: 'CLI', maskedKey: 'jifo_abcd••••••vwxyz', createdAt: '2026-05-31T00:00:00Z' },
      secret: 'jifo_secret_once'
    }));

    render(<SettingsModal open accessKeys={[]} onClose={vi.fn()} onCreateAccessKey={onCreateAccessKey} />);

    await user.click(screen.getByRole('button', { name: '新建密钥' }));
    await user.type(screen.getByLabelText('密钥备注'), 'CLI');
    await user.click(screen.getByRole('button', { name: '生成密钥' }));

    expect(onCreateAccessKey).toHaveBeenCalledWith('CLI');
    expect(await screen.findByText('jifo_secret_once')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '关闭' }));

    expect(screen.queryByText('jifo_secret_once')).not.toBeInTheDocument();
  });

  test('点击删除并确认后删除密钥', async () => {
    const user = userEvent.setup();
    const onDeleteAccessKey = vi.fn(async () => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <SettingsModal
        open
        accessKeys={[{ id: 'k1', label: 'CLI', maskedKey: 'jifo_abcd••••••vwxyz', createdAt: '2026-05-31T00:00:00Z' }]}
        onClose={vi.fn()}
        onDeleteAccessKey={onDeleteAccessKey}
      />
    );

    const deleteButton = screen.getByRole('button', { name: '删除 CLI 访问密钥' });
    expect(deleteButton).toHaveClass('access-key-action--danger');

    await user.click(deleteButton);

    expect(window.confirm).toHaveBeenCalledWith('确定要删除这个访问密钥吗？删除后使用该密钥的 CLI 或程序会立即失效。');
    expect(onDeleteAccessKey).toHaveBeenCalledWith('k1');
  });

  test('取消确认时不会删除密钥', async () => {
    const user = userEvent.setup();
    const onDeleteAccessKey = vi.fn(async () => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <SettingsModal
        open
        accessKeys={[{ id: 'k1', label: 'CLI', maskedKey: 'jifo_abcd••••••vwxyz', createdAt: '2026-05-31T00:00:00Z' }]}
        onClose={vi.fn()}
        onDeleteAccessKey={onDeleteAccessKey}
      />
    );

    await user.click(screen.getByRole('button', { name: '删除 CLI 访问密钥' }));

    expect(onDeleteAccessKey).not.toHaveBeenCalled();
  });

  test('新建密钥操作按钮使用设置页紧凑样式', async () => {
    const user = userEvent.setup();

    render(<SettingsModal open accessKeys={[]} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '新建密钥' }));

    expect(screen.getByRole('button', { name: '生成密钥' })).toHaveClass('access-key-action--primary');
    expect(screen.getByRole('button', { name: '取消' })).toHaveClass('access-key-action--ghost');
  });

  test('点击关闭按钮关闭设置弹窗', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<SettingsModal open accessKeys={[]} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '关闭设置' }));

    expect(onClose).toHaveBeenCalled();
  });
});
