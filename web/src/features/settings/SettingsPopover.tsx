type SettingsPopoverProps = {
  userName: string;
  onLogout?: () => void;
};

export function SettingsPopover({ userName, onLogout }: SettingsPopoverProps) {
  return (
    <details>
      <summary>设置</summary>
      <div style={{ display: 'grid', gap: 8, padding: 8 }}>
        <span>{userName}</span>
        {onLogout ? (
          <button type="button" onClick={onLogout}>
            退出登录
          </button>
        ) : null}
      </div>
    </details>
  );
}
