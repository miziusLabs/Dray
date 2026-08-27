export const REPO = "https://github.com/monorepo-labs/dray";

/// `/releases/latest` redirects to whatever the newest stable release is, so
/// the button needs no build-time lookup and can never point at a version that
/// has been superseded. It skips prereleases.
export const DOWNLOAD = `${REPO}/releases/latest`;

/// The universal `.dmg`'s size, decimal MB rounded to match Finder's own
/// "Get Info" — hand-updated per release since the link above deliberately
/// carries no build-time lookup to compute it from. Check the latest release's
/// asset list when bumping.
export const DOWNLOAD_SIZE = "32 MB";

/// Dray drives Pi; it does not bundle or replace it. Anyone downloading needs
/// Pi installed and configured first, so its project page is a prerequisite
/// rather than a footnote.
export const PI_SETUP = "https://github.com/badlogic/pi-mono";
