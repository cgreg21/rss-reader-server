import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const publicRaw = b64url(await crypto.subtle.exportKey('raw', publicKey));
const privateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', privateKey));

writeFileSync('vapid-keys.json', JSON.stringify({ VAPID_PUBLIC_KEY: publicRaw, VAPID_PRIVATE_JWK: privateJwk }, null, 2));
console.log('Written to vapid-keys.json (git-ignored).\n');
console.log('VAPID_PUBLIC_KEY (wrangler.toml [vars]):\n' + publicRaw + '\n');
console.log('VAPID_PRIVATE_JWK (secret: npx wrangler secret put VAPID_PRIVATE_JWK):\n' + privateJwk);
