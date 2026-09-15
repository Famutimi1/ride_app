const semanticColorTokens = [
  'primary',
  'secondary',
  'success',
  'warning',
  'danger',
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
        xl: '24px',
        '2xl': '32px',
        '3xl': '48px',
      },
      borderRadius: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
      },
      fontFamily: {
        'inter-regular': ['Inter_400Regular'],
        'inter-medium': ['Inter_500Medium'],
        'inter-semibold': ['Inter_600SemiBold'],
        'inter-bold': ['Inter_700Bold'],
      },
      fontSize: {
        h1: ['38px', { lineHeight: '44px' }],
        h2: ['32px', { lineHeight: '40px' }],
        h3: ['28px', { lineHeight: '36px' }],
        body: ['16px', { lineHeight: '24px' }],
        caption: ['14px', { lineHeight: '20px' }],
        button: ['15px', { lineHeight: '22px' }],
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
