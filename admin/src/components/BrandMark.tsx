/**
 * The Sakshay Connect mark: an "S" drawn as one circuit trace joining two nodes, yellow on a
 * black tile. Same geometry as the Android apps' BrandMark and launcher icon.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Sakshay Connect">
      <rect width="100" height="100" rx="27" fill="#111114" />
      <path
        d="M62.56 28.25 A14.5 14.5 0 1 0 50 50 A14.5 14.5 0 1 1 37.44 71.75"
        fill="none"
        stroke="#FFC51A"
        strokeWidth="11"
        strokeLinecap="round"
      />
      <circle cx="62.56" cy="28.25" r="6.8" fill="#fff" />
      <circle cx="37.44" cy="71.75" r="6.8" fill="#fff" />
    </svg>
  );
}

/** Mark and name, for the sidebar and sign-in page. */
export function Wordmark({ onDark = false, size = 30 }: { onDark?: boolean; size?: number }) {
  const ink = onDark ? '#fff' : 'var(--mantine-color-text)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <BrandMark size={size} />
      <span style={{ fontSize: size * 0.6, letterSpacing: '-0.02em', color: ink, lineHeight: 1.1 }}>
        <b style={{ fontWeight: 900 }}>Sakshay</b> <span style={{ fontWeight: 500, opacity: 0.8 }}>Connect</span>
      </span>
    </span>
  );
}
