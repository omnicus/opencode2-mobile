// A typed address without a scheme gets one: http:// for hosts that are usually on the same
// network, https:// for everything else. Cleartext HTTP still needs the per-connection switch.
export function withInferredScheme(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  const authority = trimmed.split(/[/?#]/, 1)[0] ?? "";
  return `${isLocalNetworkHost(hostOf(authority)) ? "http" : "https"}://${trimmed}`;
}

export function addressHostname(value: string) {
  try {
    return new URL(withInferredScheme(value)).hostname;
  } catch {
    return undefined;
  }
}

function hostOf(authority: string) {
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":", 1)[0] ?? "";
}

function isLocalNetworkHost(host: string) {
  const name = host.toLowerCase();
  if (name === "localhost" || name.endsWith(".local") || name === "[::1]") return true;
  const octets = name.split(".");
  if (octets.length !== 4 || !octets.every((octet) => /^\d{1,3}$/.test(octet))) return false;
  const [a = 0, b = 0] = octets.map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
