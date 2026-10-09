/** Light team tint. Keeps gold, timber and stone; does not flatten the sprite. */
export function OwnershipFilters() {
  const tint: Record<string, string> = {
    neutral:
      '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0',
    red:
      '1.08 0.04 0 0 0.05  0 0.9 0 0 0  0 0 0.84 0 0  0 0 0 1 0',
    purple:
      '1.02 0 0.04 0 0.03  0 0.9 0 0 0.01  0.02 0 1.06 0 0.04  0 0 0 1 0',
    green:
      '0.86 0 0 0 0  0.04 1.06 0 0 0.03  0 0 0.88 0 0  0 0 0 1 0',
  };
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      style={{ position: 'absolute', pointerEvents: 'none' }}
    >
      <defs>
        {(['neutral', 'red', 'purple', 'green'] as const).map((team) => (
          <filter
            key={team}
            id={`resource-${team}`}
            colorInterpolationFilters="sRGB"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values={tint[team]}
            />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
