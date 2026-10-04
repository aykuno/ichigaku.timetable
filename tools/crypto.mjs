export async function decryptHtml(payload, password) {
  if (!payload || payload.version !== 1 || payload.algorithm !== 'AES-256-GCM' ||
      payload.kdf !== 'PBKDF2-SHA-256' || payload.iterations !== 600000 ||
      typeof password !== 'string' || !password.length || password.length > 1024) {
    throw new Error('Invalid protected document');
  }
  function decode(value, expectedLength) {
    if (typeof value !== 'string' || value.length > 1400000 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
      throw new Error('Invalid encrypted data');
    }
    const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    if ((expectedLength && bytes.length !== expectedLength) ||
        (!expectedLength && bytes.length < 17)) throw new Error('Invalid encrypted data');
    return bytes;
  }
  const salt = decode(payload.salt, 16);
  const iv = decode(payload.iv, 12);
  const ciphertext = decode(payload.ciphertext);
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {name: 'PBKDF2', hash: 'SHA-256', salt, iterations: payload.iterations},
    material, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    {name: 'AES-GCM', iv, tagLength: 128}, key, ciphertext);
  return new TextDecoder('utf-8', {fatal: true}).decode(plaintext);
}
