export function deviceLabel(nav: {
  userAgentData?: { brands: { brand: string }[]; platform: string };
  brave?: unknown;
}): string {
  const brands = nav.userAgentData?.brands.map((b) => b.brand) ?? [];
  const has = (brand: string) => brands.includes(brand);
  const browser =
    nav.brave !== undefined || has('Brave')
      ? 'Brave'
      : has('Microsoft Edge')
        ? 'Edge'
        : has('Google Chrome')
          ? 'Chrome'
          : has('Chromium')
            ? 'Chromium'
            : 'Browser';
  const platform = nav.userAgentData?.platform;
  const os = platform && platform !== 'Unknown' ? platform : null;
  return os ? `${browser} on ${os}` : browser;
}

/** The keys of the send shortcut the manifest suggests, as this platform names them. */
export function keysFor(nav: { userAgentData?: { platform: string }; platform?: string }): string[] {
  const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac/i.test(platform) ? ['⌘', '⇧', 'S'] : ['Ctrl', 'Shift', 'S'];
}
