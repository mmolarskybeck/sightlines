// Geist TTFs for PDF text (spec §16 font strategy): fetched lazily from the
// app's own static assets at export time — never part of the entry bundle —
// and cached for the session. Regular carries body/labels; SemiBold carries
// headers ("strong"), the closest static cut to the UI's 680 weight token.
// Fail-open on any fetch problem: the writer's standard-Helvetica path plus
// its glyph-substitution warning is a working export, a thrown fetch is not.
// License: SIL OFL 1.1, shipped beside the files (public/fonts/GEIST-LICENSE.txt).

export type PdfFontBytes = { regular: Uint8Array; strong: Uint8Array };

const REGULAR_URL = "/fonts/Geist-Regular.ttf";
const STRONG_URL = "/fonts/Geist-SemiBold.ttf";

let cached: PdfFontBytes | null = null;

async function fetchFontBytes(
  url: string,
  fetchFn: typeof fetch
): Promise<Uint8Array> {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Font fetch failed: ${url} (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A dev-server SPA fallback answers font URLs with index.html and status
  // 200; embedding that would fail deep inside the writer. TTF files start
  // with the 0x00010000 sfnt version tag ("true"/"OTTO" variants aren't
  // shipped here).
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x00 ||
    bytes[1] !== 0x01 ||
    bytes[2] !== 0x00 ||
    bytes[3] !== 0x00
  ) {
    throw new Error(`Font fetch returned non-TTF data: ${url}`);
  }
  return bytes;
}

export async function loadPdfFontBytes(
  fetchFn: typeof fetch = fetch
): Promise<PdfFontBytes | undefined> {
  if (cached) return cached;
  try {
    const [regular, strong] = await Promise.all([
      fetchFontBytes(REGULAR_URL, fetchFn),
      fetchFontBytes(STRONG_URL, fetchFn)
    ]);
    cached = { regular, strong };
    return cached;
  } catch {
    return undefined;
  }
}

export function resetPdfFontCacheForTests(): void {
  cached = null;
}
