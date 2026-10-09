/** Recolour blue team trim without changing gold, timber or stone materials. */
export function OwnershipFilters() {
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
            x="-10%"
            y="-10%"
            width="120%"
            height="120%"
          >
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -1 -0.3 1.3 0 0"
              result="blueChannel"
            />
            <feComponentTransfer in="blueChannel" result="blueThreshold">
              <feFuncA type="linear" slope="10" intercept="-0.5" />
            </feComponentTransfer>
            <feComposite
              in="blueThreshold"
              in2="SourceAlpha"
              operator="in"
              result="trimMask"
            />
            <feColorMatrix
              in="SourceGraphic"
              type={team === 'neutral' ? 'saturate' : 'hueRotate'}
              values={
                team === 'neutral'
                  ? '0'
                  : team === 'red'
                    ? '140'
                    : team === 'purple'
                      ? '45'
                      : '-85'
              }
              result="coloured"
            />
            <feComposite
              in="coloured"
              in2="trimMask"
              operator="in"
              result="teamTrim"
            />
            <feComposite
              in="SourceGraphic"
              in2="trimMask"
              operator="out"
              result="materials"
            />
            <feComposite
              in="materials"
              in2="teamTrim"
              operator="arithmetic"
              k2="1"
              k3="1"
            />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
