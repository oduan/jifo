import { Button } from '../../shared/ui/Button';

type SettingsPopoverProps = {
  userName: string;
  onLogout?: () => void;
};

export function SettingsPopover({ userName, onLogout }: SettingsPopoverProps) {
  return (
    <details className="settings-popover">
      <summary>设置</summary>
      <div className="settings-panel">
        <span>{userName}</span>
        {onLogout ? (
          <Button type="button" variant="ghost" onClick={onLogout}>
            退出登录
          </Button>
        ) : null}
      </div>
    </details>
  );
}
