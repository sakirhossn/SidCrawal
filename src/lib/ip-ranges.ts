export function isPrivateOrReservedIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = octets;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true; // IETF protocol / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

function expandIpv6Groups(address: string): number[] | null {
  let clean = address.replace(/^\[|\]$/g, "").toLowerCase();
  const zoneIdx = clean.indexOf("%");
  if (zoneIdx !== -1) {
    clean = clean.slice(0, zoneIdx);
  }
  if (!clean.includes(":")) {
    return null;
  }

  // Handle embedded dotted-quad IPv4 suffix (e.g., ::ffff:127.0.0.1)
  const lastColon = clean.lastIndexOf(":");
  const tail = clean.slice(lastColon + 1);
  if (tail.includes(".")) {
    const ipv4Parts = tail.split(".");
    if (ipv4Parts.length !== 4) return null;
    const nums = ipv4Parts.map(Number);
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((nums[0] << 8) | nums[1]).toString(16);
    const lo = ((nums[2] << 8) | nums[3]).toString(16);
    clean = `${clean.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const halves = clean.split("::");
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const missing = 8 - (left.length + right.length);
  if (halves.length === 1 && left.length !== 8) return null;
  if (halves.length === 2 && missing < 0) return null;

  const fullStrings = [
    ...left,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"),
    ...right,
  ];
  if (fullStrings.length !== 8) return null;

  const groups: number[] = [];
  for (const part of fullStrings) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    groups.push(parseInt(part, 16));
  }
  return groups;
}

export function isPrivateOrReservedIpv6(address: string): boolean {
  const groups = expandIpv6Groups(address);
  if (!groups) {
    return false;
  }

  // :: (unspecified) and ::1 (loopback)
  const allZeroPrefix = groups.slice(0, 7).every((g) => g === 0);
  if (allZeroPrefix && (groups[7] === 0 || groups[7] === 1)) {
    return true;
  }

  // IPv4-mapped ::ffff:0:0/96 or ::/96 IPv4-compatible
  const isV4Mapped =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    (groups[5] === 0xffff || groups[5] === 0);
  if (isV4Mapped) {
    const dotted = `${(groups[6] >> 8) & 0xff}.${groups[6] & 0xff}.${(groups[7] >> 8) & 0xff}.${groups[7] & 0xff}`;
    return isPrivateOrReservedIpv4(dotted);
  }

  // fc00::/7 Unique local addresses
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  // fe80::/10 Link-local
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  // ff00::/8 Multicast
  if ((groups[0] & 0xff00) === 0xff00) return true;
  // 64:ff9b::/96 NAT64 well-known prefix
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) return true;

  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  if (ip.includes(":")) {
    return isPrivateOrReservedIpv6(ip);
  }
  return isPrivateOrReservedIpv4(ip);
}
