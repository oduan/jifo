import { FormEvent, useEffect, useState } from 'react';

import { Button } from '../../shared/ui/Button';
import { TextInput } from '../../shared/ui/Input';
import { AccessKeySummary, CreateAccessKeyResult } from './api';

type SettingsModalProps = {
  open: boolean;
  accessKeys: AccessKeySummary[];
  isLoading?: boolean;
  isCreating?: boolean;
  error?: string | null;
  onClose: () => void;
  onLoadAccessKeys?: () => void | Promise<void>;
  onCreateAccessKey?: (label: string) => Promise<CreateAccessKeyResult>;
  onDeleteAccessKey?: (id: string) => Promise<void>;
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<void>;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function SettingsModal({ open, accessKeys, isLoading = false, isCreating = false, error, onClose, onLoadAccessKeys, onCreateAccessKey, onDeleteAccessKey, onChangePassword }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<'account' | 'keys'>('keys');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [label, setLabel] = useState('');
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setChangingPassword] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      if (activeSection === 'keys') {
        void onLoadAccessKeys?.();
      }
    } else {
      setActiveSection('keys');
      setShowCreateForm(false);
      setLabel('');
      setGeneratedSecret(null);
      setCopied(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setAccountError(null);
    }
  }, [activeSection, open, onLoadAccessKeys]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onCreateAccessKey?.(label);
    if (result) {
      setGeneratedSecret(result.secret);
      setShowCreateForm(false);
      setLabel('');
      setCopied(false);
      await onLoadAccessKeys?.();
    }
  };

  const copySecret = async () => {
    if (!generatedSecret) {
      return;
    }
    await navigator.clipboard?.writeText?.(generatedSecret);
    setCopied(true);
  };

  const deleteKey = async (key: AccessKeySummary) => {
    if (!window.confirm('确定要删除这个访问密钥吗？删除后使用该密钥的 CLI 或程序会立即失效。')) {
      return;
    }
    await onDeleteAccessKey?.(key.id);
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setAccountError(null);
    if (newPassword.length < 8 || newPassword.length > 72) {
      setAccountError('新密码长度需要在 8 到 72 位之间。');
      return;
    }
    if (newPassword !== confirmPassword) {
      setAccountError('两次输入的新密码不一致。');
      return;
    }
    setChangingPassword(true);
    try {
      await onChangePassword?.(currentPassword, newPassword);
    } catch (changeError) {
      setAccountError(changeError instanceof Error ? changeError.message : '修改密码失败，请稍后重试。');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      <div className="settings-modal__backdrop" aria-hidden="true" />
      <div className="settings-modal__surface">
        <header className="settings-modal__header">
          <h2 id="settings-modal-title">设置</h2>
          <Button type="button" variant="ghost" className="settings-modal__close" aria-label="关闭设置" onClick={onClose}>
            ×
          </Button>
        </header>
        <div className="settings-modal__body">
          <aside className="settings-modal__nav" aria-label="设置菜单">
            <button type="button" className={`settings-modal__nav-item ${activeSection === 'account' ? 'settings-modal__nav-item--active' : ''}`} aria-pressed={activeSection === 'account'} onClick={() => setActiveSection('account')}>
              账户
            </button>
            <button type="button" className={`settings-modal__nav-item ${activeSection === 'keys' ? 'settings-modal__nav-item--active' : ''}`} aria-pressed={activeSection === 'keys'} onClick={() => setActiveSection('keys')}>
              密钥
            </button>
          </aside>
          {activeSection === 'account' ? (
            <section className="settings-modal__content" aria-label="账户设置">
              <div className="settings-modal__section-head">
                <div>
                  <h3>修改密码</h3>
                  <p>修改后会退出所有已登录设备，需要使用新密码重新登录。</p>
                </div>
              </div>
              <form className="account-password-form" onSubmit={submitPassword}>
                <label htmlFor="current-password">当前密码</label>
                <TextInput id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
                <label htmlFor="new-password">新密码</label>
                <TextInput id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={72} required />
                <label htmlFor="confirm-password">确认新密码</label>
                <TextInput id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} maxLength={72} required />
                {accountError ? <div className="settings-modal__error" role="alert">{accountError}</div> : null}
                <div className="account-password-form__actions">
                  <Button type="submit" variant="primary" disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}>
                    {isChangingPassword ? '正在修改…' : '修改密码'}
                  </Button>
                </div>
              </form>
            </section>
          ) : (
          <section className="settings-modal__content" aria-label="密钥设置">
            <div className="settings-modal__section-head">
              <div>
                <h3>访问密钥</h3>
                <p>用于命令行版本或其它程序访问你的笔记、标签和设置。</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => setShowCreateForm(true)}>
                新建密钥
              </Button>
            </div>

            {showCreateForm ? (
              <form className="access-key-create" onSubmit={submitCreate}>
                <label htmlFor="access-key-label">密钥备注</label>
                <div className="access-key-create__row">
                  <TextInput id="access-key-label" name="access-key-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：Mac CLI" />
                  <Button type="submit" variant="primary" className="access-key-action access-key-action--primary" disabled={isCreating || !label.trim()}>
                    生成密钥
                  </Button>
                  <Button type="button" variant="ghost" className="access-key-action access-key-action--ghost" onClick={() => setShowCreateForm(false)}>
                    取消
                  </Button>
                </div>
              </form>
            ) : null}

            {generatedSecret ? (
              <div className="access-key-secret" role="status">
                <strong>请立即复制这串密钥，它只会显示一次。</strong>
                <code>{generatedSecret}</code>
                <div className="access-key-secret__actions">
                  <Button type="button" variant="secondary" onClick={copySecret}>
                    {copied ? '已复制' : '复制'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setGeneratedSecret(null)}>
                    关闭
                  </Button>
                </div>
              </div>
            ) : null}

            {error ? <div className="settings-modal__error" role="alert">{error}</div> : null}

            {isLoading ? <div className="settings-modal__hint">正在加载密钥…</div> : null}
            {!isLoading && accessKeys.length === 0 ? <div className="settings-modal__empty">还没有密钥。创建一个密钥，用于 CLI 或其它程序访问 Jifo。</div> : null}
            {accessKeys.length > 0 ? (
              <ul className="access-key-list" aria-label="已生成的密钥">
                {accessKeys.map((key) => (
                  <li key={key.id} className="access-key-list__item">
                    <div className="access-key-list__meta">
                      <strong>{key.label}</strong>
                      <span>{key.maskedKey}</span>
                    </div>
                    <div className="access-key-list__actions">
                      <time dateTime={key.createdAt}>{formatDate(key.createdAt)}</time>
                      <Button type="button" variant="ghost" className="access-key-action access-key-action--danger" aria-label={`删除 ${key.label} 访问密钥`} onClick={() => void deleteKey(key)}>
                        删除
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          )}
        </div>
      </div>
    </div>
  );
}
