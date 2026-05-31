import { FocusEvent, MouseEvent, useEffect, useRef, useState } from 'react';

import { Button } from '../../shared/ui/Button';

type SettingsPopoverProps = {
  userName: string;
  onLogout?: () => void;
};

export function SettingsPopover({ userName, onLogout }: SettingsPopoverProps) {
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

  return (
    <details ref={popoverRef} className="settings-popover" open={isOpen} onBlur={closeOnBlur}>
      <summary className="settings-trigger" role="button" aria-label={`${userName} 设置菜单`} aria-expanded={isOpen} title="设置" onClick={toggleMenu}>
        <span className="user-name">{userName}</span>
        <span className="settings-trigger__chevron" aria-hidden="true">▾</span>
      </summary>
      {isOpen ? (
        <div className="settings-panel">
          <span className="settings-panel__user">{userName}</span>
          {onLogout ? (
            <Button type="button" variant="ghost" onClick={onLogout}>
              退出登录
            </Button>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
