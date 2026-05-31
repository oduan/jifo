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
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function SettingsModal({ open, accessKeys, isLoading = false, isCreating = false, error, onClose, onLoadAccessKeys, onCreateAccessKey }: SettingsModalProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [label, setLabel] = useState('');
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      void onLoadAccessKeys?.();
    } else {
      setShowCreateForm(false);
      setLabel('');
      setGeneratedSecret(null);
      setCopied(false);
    }
  }, [open, onLoadAccessKeys]);

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
            <button type="button" className="settings-modal__nav-item settings-modal__nav-item--active" aria-pressed="true">
              密钥
            </button>
          </aside>
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
                  <Button type="submit" variant="primary" disabled={isCreating || !label.trim()}>
                    生成密钥
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowCreateForm(false)}>
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
                    <div>
                      <strong>{key.label}</strong>
                      <span>{key.maskedKey}</span>
                    </div>
                    <time dateTime={key.createdAt}>{formatDate(key.createdAt)}</time>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
