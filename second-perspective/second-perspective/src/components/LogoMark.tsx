export default function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="13" cy="16" r="10.5" fill="var(--color-primary)" opacity="0.9" />
      <circle cx="19" cy="16" r="10.5" fill="var(--color-secondary)" opacity="0.75" />
      <circle cx="16" cy="16" r="3.2" fill="var(--color-paper)" />
    </svg>
  );
}
