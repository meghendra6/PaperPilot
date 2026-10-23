/**
 * IP literal parsing and the fail-closed public-address test shared by the
 * discovery network boundary and the chat link filter.
 */
export function parseIPv4(value: string) {
  const parts = value.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : undefined;
}

export function parseIPv6(value: string) {
  let normalized = value.toLowerCase().split("%")[0];
  const dottedTail = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dottedTail) {
    const ipv4 = parseIPv4(dottedTail);
    if (!ipv4) return undefined;
    const [a, b, c, d] = ipv4;
    normalized = `${normalized.slice(0, -dottedTail.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  if (!/^[0-9a-f:]+$/.test(normalized) || normalized.split("::").length > 2) {
    return undefined;
  }
  const [leftText, rightText] = normalized.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return undefined;
  }
  const missing = 8 - left.length - right.length;
  if (
    (normalized.includes("::") && missing < 1) ||
    (!normalized.includes("::") && missing !== 0)
  ) {
    return undefined;
  }
  return [...left, ...Array(Math.max(0, missing)).fill("0"), ...right].map(
    (part) => Number.parseInt(part, 16),
  );
}

export function isNonPublicIPAddress(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  const ipv4 = parseIPv4(normalized);
  if (ipv4) {
    const [a, b, c] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (!normalized.includes(":")) return false;
  const words = parseIPv6(normalized);
  if (!words) return true;

  // Fail closed: only globally routable IPv6 unicast (2000::/3) may cross the
  // official-source boundary. Explicitly reject documentation, benchmark,
  // ORCHID, and transition ranges inside that aggregate.
  if (words[0] < 0x2000 || words[0] > 0x3fff) return true;
  if (words[0] === 0x2001) {
    if (words[1] === 0x0000) return true; // Teredo and related special use
    if (words[1] === 0x0002) return true; // benchmarking
    if (words[1] === 0x0db8) return true; // documentation
    if (words[1] >= 0x0010 && words[1] <= 0x002f) return true; // ORCHID
  }
  if (words[0] === 0x2002) {
    const embedded = [
      words[1] >> 8,
      words[1] & 255,
      words[2] >> 8,
      words[2] & 255,
    ].join(".");
    return isNonPublicIPAddress(embedded);
  }
  return false;
}

export function isIPAddressLiteral(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  return Boolean(parseIPv4(normalized) || parseIPv6(normalized));
}
