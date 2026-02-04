export function base64Encode(input: string) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('base64');
  }
  return btoa(input);
}

export function base64Decode(input: string) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'base64').toString('utf8');
  }
  return atob(input);
}

export function base64UrlEncode(bytes: Uint8Array | Buffer) {
  if (typeof Buffer !== 'undefined') {
    const buf = bytes instanceof Buffer ? bytes : Buffer.from(bytes);
    return buf.toString('base64url');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlDecode(str: string) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(str, 'base64url'));
  }
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (base64.length % 4)) % 4;
  base64 += '='.repeat(padLength);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64UrlEncodeString(input: string) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('base64url');
  }
  return base64UrlEncode(new TextEncoder().encode(input));
}

export function base64UrlDecodeString(input: string) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'base64url').toString('utf8');
  }
  return new TextDecoder().decode(base64UrlDecode(input));
}

export function base64UrlEncodeJson(obj: unknown) {
  try {
    return base64UrlEncodeString(JSON.stringify(obj));
  } catch {
    return '';
  }
}

export function base64UrlDecodeJson<T = unknown>(value: string) {
  try {
    return JSON.parse(base64UrlDecodeString(value)) as T;
  } catch {
    return null;
  }
}
