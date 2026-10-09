/** Light team tint for owned mines and mills. Neutral turns baked-in blue gray and leaves gold, timber, and stone. */
export function OwnershipFilters() {
  const tint: Record<string, string> = {
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
        <filter
          id="resource-neutral"
          colorInterpolationFilters="sRGB"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
            result="gray"
          />
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1.2 -1.2 2.4 0 0"
            result="blueMask"
          />
          <feComponentTransfer in="blueMask" result="blueGate">
            <feFuncA type="linear" slope="1.7" intercept="-0.2" />
          </feComponentTransfer>
          <feComposite in="gray" in2="blueGate" operator="in" result="grayBlue" />
          <feComposite in="SourceGraphic" in2="blueGate" operator="out" result="keep" />
          <feComposite in="grayBlue" in2="keep" operator="over" />
        </filter>
        {(['red', 'purple', 'green'] as const).map((team) => (
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
