export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg aria-label="第二视角" width={size} height={size} viewBox="0 0 32 32">
      <circle cx="13" cy="16" r="10.5" fill="var(--color-primary)" opacity="0.9" />
      <circle cx="19" cy="16" r="10.5" fill="var(--color-secondary)" opacity="0.75" />
      <circle cx="16" cy="16" r="3.2" fill="var(--color-paper)" />
    </svg>
  );
}
