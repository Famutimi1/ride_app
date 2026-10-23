/** Rakky Ride colors. Raw values live only in palette; consumers use semantic tokens. */
const palette = {
  forest: '#176B17',
  leaf: '#83E46F',
  emerald: '#176B45',
  mint: '#79DDB1',
  amber: '#8A5700',
  gold: '#F7C66B',
  red: '#B42318',
  rose: '#FFABA3',
  teal: '#086C64',
  aqua: '#63DCD0',
  markerTeal: '#008F8B',
  markerCoral: '#FF4538',
  markerRed: '#D7193F',
  markerViolet: '#873FD1',
  transparent: 'transparent',
  white: '#FFFFFF',
  silver50: '#F7F8F6',
  silver100: '#EEF1EC',
  silver200: '#DEE3DA',
  silver300: '#CCD3C7',
  silver400: '#ADB7A6',
  gray: '#586253',
  boundary: '#798572',
  charcoal: '#141A14',
  charcoalRaised: '#202820',
  charcoalMuted: '#2D372C',
  charcoalBorder: '#45513F',
  charcoalBoundary: '#89977F',
  lightPrimaryTint: '#EAF5E5',
  lightSuccessTint: '#E4F3EB',
  lightWarningTint: '#FFF3D8',
  lightDangerTint: '#FCEBE9',
  darkPrimaryTint: '#263D20',
  darkSuccessTint: '#1E3A2D',
  darkWarningTint: '#3D321C',
  darkDangerTint: '#432724',
  overlayLight: '#141A1473',
  overlayDark: '#00000099',
  shadowSm: '#141A140F',
  shadowMd: '#141A141A',
  shadowLg: '#141A1424',
  mapWaterAqua: '#9CD7E9',
} as const;

export const shadowColors = {
  sm: palette.shadowSm,
  md: palette.shadowMd,
  lg: palette.shadowLg,
} as const;

// Build-time consumers can import these without loading hooks or app state.
export const nativeBrandColors = {
  primary: palette.forest,
  lightBackground: palette.white,
  darkBackground: palette.charcoal,
  iconBackground: palette.white,
} as const;

export const lightColors = {
  primary: palette.forest,
  secondary: palette.gray,
  success: palette.emerald,
  warning: palette.amber,
  danger: palette.red,
  mapPickup: palette.markerTeal,
  mapDropoff: palette.markerCoral,
  mapDriver: palette.teal,
  mapNearbyDriver: palette.gray,
  mapRider: palette.markerRed,
  mapPicker: palette.markerViolet,
  mapMarkerOutline: palette.white,
  mapMarkerTransparent: palette.transparent,
  primarySoft: palette.lightPrimaryTint,
  successSoft: palette.lightSuccessTint,
  warningSoft: palette.lightWarningTint,
  dangerSoft: palette.lightDangerTint,
  background: palette.white,
  surface: palette.white,
  surfaceMuted: palette.silver100,
  border: palette.silver200,
  borderStrong: palette.boundary,
  text: palette.charcoal,
  textMuted: palette.gray,
  textInverse: palette.white,
  icon: palette.gray,
  overlay: palette.overlayLight,
  skeleton: palette.silver200,
} as const;

export type AppColors = Record<keyof typeof lightColors, string>;

export const darkColors: AppColors = {
  primary: palette.leaf,
  secondary: palette.silver400,
  success: palette.mint,
  warning: palette.gold,
  danger: palette.rose,
  mapPickup: palette.aqua,
  mapDropoff: palette.markerCoral,
  mapDriver: palette.aqua,
  mapNearbyDriver: palette.silver400,
  mapRider: palette.markerRed,
  mapPicker: palette.markerViolet,
  mapMarkerOutline: palette.white,
  mapMarkerTransparent: palette.transparent,
  primarySoft: palette.darkPrimaryTint,
  successSoft: palette.darkSuccessTint,
  warningSoft: palette.darkWarningTint,
  dangerSoft: palette.darkDangerTint,
  background: palette.charcoal,
  surface: palette.charcoalRaised,
  surfaceMuted: palette.charcoalMuted,
  border: palette.charcoalBorder,
  borderStrong: palette.charcoalBoundary,
  text: palette.silver50,
  textMuted: palette.silver400,
  textInverse: palette.charcoal,
  icon: palette.silver400,
  overlay: palette.overlayDark,
  skeleton: palette.charcoalBorder,
};

const mapVisibilityStyles = [
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
] as const;

export const mapStyles = {
  light: [
    ...mapVisibilityStyles,
    { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: palette.silver50 }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: palette.white }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: palette.silver200 }] },
  ],
  dark: [
    { elementType: 'geometry', stylers: [{ color: palette.charcoal }] },
    { elementType: 'labels.text.fill', stylers: [{ color: palette.silver400 }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: palette.charcoal }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: palette.charcoalMuted }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: palette.charcoalRaised }] },
  ],
} as const;

/** Use the web map's soft aqua water instead of the earlier blue override. */
export const androidMapStyle = [
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: palette.mapWaterAqua }] },
] as const;
