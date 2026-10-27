// Metro sets NATIVEWIND_OS for each platform's stylesheet. Resolve sizes here:
// NativeWind 4's platformSelect emits a native function even for "web", which
// browsers discard instead of applying the font size and line height.
const androidSize = (android, other) =>
  `${process.env.NATIVEWIND_OS === 'android' ? android : other}px`;

const semanticColorTokens = [
  'primary',
  'secondary',
  'success',
  'warning',
  'danger',
  'mapPickup',
  'mapDropoff',
  'mapDriver',
  'mapNearbyDriver',
  'mapRider',
  'mapPicker',
  'mapMarkerOutline',
  'mapMarkerTransparent',
  'primarySoft',
  'successSoft',
  'warningSoft',
  'dangerSoft',
  'background',
  'surface',
  'surfaceMuted',
  'border',
  'borderStrong',
  'text',
  'textMuted',
  'textInverse',
  'icon',
  'overlay',
  'skeleton',
];

const semanticColors = Object.fromEntries(
  semanticColorTokens.map((token) => [token, `var(--color-${token})`]),
);

module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: semanticColors,
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '28px',
        '3xl': '40px',
      },
      borderRadius: {
        xs: '3px',
        sm: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '14px',
      },
      fontFamily: {
        'inter-regular': ['Inter_400Regular'],
        'inter-medium': ['Inter_500Medium'],
        'inter-semibold': ['Inter_600SemiBold'],
        'inter-bold': ['Inter_700Bold'],
      },
      fontSize: {
        h1: [androidSize(33, 30), { lineHeight: androidSize(40, 36), letterSpacing: '-0.7px' }],
        h2: [androidSize(27, 24), { lineHeight: androidSize(34, 30), letterSpacing: '-0.5px' }],
        h3: [androidSize(23, 20), { lineHeight: androidSize(30, 26), letterSpacing: '-0.3px' }],
        body: [androidSize(17, 15), { lineHeight: androidSize(26, 22) }],
        caption: [androidSize(15, 13), { lineHeight: androidSize(22, 18) }],
        button: [androidSize(16, 14), { lineHeight: androidSize(24, 20) }],
      },
      boxShadow: {
        sm: '0px 1px 4px var(--shadow-sm)',
        md: '0px 4px 12px var(--shadow-md)',
        lg: '0px 8px 24px var(--shadow-lg)',
      },
      elevation: {
        sm: '1',
        md: '4',
        lg: '10',
      },
    },
  },
  plugins: [],
};
