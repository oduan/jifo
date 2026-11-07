import { FocusEvent, MouseEvent, useEffect, useRef, useState } from 'react';

import { Button } from '../../shared/ui/Button';

type SettingsPopoverProps = {
  userName: string;
  // 选项参数留给「登出并清除本地数据」路径;弹层里的退出登录是默认的仅登出。
  onLogout?: (options?: { clearLocalData?: boolean }) => void | Promise<void>;
  onOpenSettings?: () => void;
};

export function SettingsPopover({ userName, onLogout, onOpenSettings }: SettingsPopoverProps) {
  const [isOpen, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const toggleMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setOpen((open) => !open);
  };

  const closeOnBlur = (event: FocusEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
    }
  };

  const openSettings = () => {
    setOpen(false);
    onOpenSettings?.();
  };

  return (
    <details ref={popoverRef} className="settings-popover" open={isOpen} onBlur={closeOnBlur}>
      <summary className="settings-trigger" role="button" aria-label={`${userName} 设置菜单`} aria-expanded={isOpen} title="设置" onClick={toggleMenu}>
        <span className="user-name">{userName}</span>
        <span className="settings-trigger__chevron" aria-hidden="true">▾</span>
      </summary>
      {isOpen ? (
        <div className="settings-panel">
          <span className="settings-panel__user">{userName}</span>
          <Button type="button" variant="ghost" className="dropdown-menu__item" onClick={openSettings}>
            设置
          </Button>
          {onLogout ? (
            // 包一层避免把点击事件对象当作 onLogout 的 options 参数传入
            <Button type="button" variant="ghost" className="dropdown-menu__item" onClick={() => void onLogout?.()}>
              退出登录
            </Button>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
