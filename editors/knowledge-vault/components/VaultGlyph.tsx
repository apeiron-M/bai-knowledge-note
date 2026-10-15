/**
 * The vault's own constellation at icon size, beside its name (design: the
 * signature taken from concept C): a hub and up to six of its largest topics,
 * placed from their ids so a vault always draws the same shape. An empty
 * vault draws the hub alone.
 */
function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function glyphPoints(seeds: string[]): { x: number; y: number; r: number }[] {
  const picked = seeds.slice(0, 6);
  return picked.map((id, i) => {
    const h = hash(id);
    const angle = (i / picked.length) * Math.PI * 2 - Math.PI / 2 + (((h % 41) - 20) * Math.PI) / 360;
    const dist = 31 + (h % 9);
    return {
      x: Math.round((50 + Math.cos(angle) * dist) * 10) / 10,
      y: Math.round((50 + Math.sin(angle) * dist) * 10) / 10,
      r: 7 + (h % 4),
    };
  });
}

export function VaultGlyph({ seeds, size = 18 }: { seeds: string[]; size?: number }) {
  const points = glyphPoints(seeds);
  return (
    <svg className="vault-glyph" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      {points.map((p, i) => (
        <line key={`l${i}`} x1={50} y1={50} x2={p.x} y2={p.y} />
      ))}
      {points.map((p, i) => (
        <circle key={`c${i}`} cx={p.x} cy={p.y} r={p.r} />
      ))}
      <circle className="hub" cx={50} cy={50} r={points.length ? 11 : 16} />
    </svg>
  );
}
