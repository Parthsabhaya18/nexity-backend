/** Bytes needed to identify every supported format. */
export const SNIFF_BYTES = 32;

const ascii = (b: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...b.subarray(start, end));

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis']);
const HEIF_BRANDS = new Set(['mif1', 'msf1', 'heif']);
/** Legacy QuickTime files start with an atom other than `ftyp`. */
const QUICKTIME_ATOMS = new Set(['moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);

/** Identifies the real format from the file's leading bytes, regardless of the declared type. */
export function detectContentType(b: Uint8Array): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    ascii(b, 1, 4) === 'PNG' &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (b.length >= 12) {
    const atom = ascii(b, 4, 8);
    if (atom === 'ftyp') {
      const brand = ascii(b, 8, 12);
      if (HEIC_BRANDS.has(brand)) return 'image/heic';
      if (HEIF_BRANDS.has(brand)) return 'image/heif';
      if (brand === 'qt  ') return 'video/quicktime';
      if (brand === 'M4A ' || brand === 'M4B ') return 'audio/mp4';
      if (brand === 'avif' || brand === 'avis') return null;
      return 'video/mp4';
    }
    if (QUICKTIME_ATOMS.has(atom)) return 'video/quicktime';
  }
  return null;
}

/** Containers that devices commonly label interchangeably. */
const FAMILY: Record<string, string> = {
  'image/heic': 'heif',
  'image/heif': 'heif',
  'video/mp4': 'isobmff-video',
  'video/quicktime': 'isobmff-video',
  /** Android's recorder writes audio-only files with generic `isom` / `mp42` brands. */
  'audio/mp4': 'isobmff-video',
};

export function isCompatibleType(declared: string, detected: string | null) {
  if (!detected) return false;
  if (declared === detected) return true;
  const family = FAMILY[declared];
  return family !== undefined && family === FAMILY[detected];
}
