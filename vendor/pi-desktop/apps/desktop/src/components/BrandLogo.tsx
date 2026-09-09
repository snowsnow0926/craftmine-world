export function BrandLogo({ size = 16 }: { size?: number }) {
  return (
    <svg className="brand-logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2 29 9.5 16 17 3 9.5Z" fill="currentColor" opacity=".92" />
      <path d="M3 12 14.5 18.7V30L3 23.3Z" fill="currentColor" opacity=".42" />
      <path d="M29 12 17.5 18.7V30L29 23.3Z" fill="currentColor" opacity=".68" />
    </svg>
  );
}
