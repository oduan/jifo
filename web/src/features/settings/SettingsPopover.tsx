import { Button } from '../../shared/ui/Button';

type SettingsPopoverProps = {
  userName: string;
  onLogout?: () => void;
};

export function SettingsPopover({ userName, onLogout }: SettingsPopoverProps) {
  return (
    <details className="settings-popover">
      <summary className="settings-trigger" aria-label="打开设置菜单" title="设置">
        <span aria-hidden="true">⌄</span>
      </summary>
      <div className="settings-panel">
        <span className="settings-panel__user">{userName}</span>
        {onLogout ? (
          <Button type="button" variant="ghost" onClick={onLogout}>
            退出登录
          </Button>
        ) : null}
      </div>
    </details>
  );
}
