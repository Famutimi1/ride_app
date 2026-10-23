/** Android's expo-image data loader expects base64, even for SVG images. */
export function svgDataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    encoded += alphabet[first >> 2];
    encoded += alphabet[((first & 3) << 4) | (second >> 4)];
    encoded += index + 1 < bytes.length ? alphabet[((second & 15) << 2) | (third >> 6)] : '=';
    encoded += index + 2 < bytes.length ? alphabet[third & 63] : '=';
  }
  return `data:image/svg+xml;base64,${encoded}`;
}
