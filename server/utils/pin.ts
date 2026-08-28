import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Empreinte du code PIN de verrouillage.
 *
 * `scrypt` et non un simple SHA-256 : un PIN à quatre chiffres n'a que dix
 * mille valeurs. Une fonction rapide se force en une fraction de seconde ;
 * `scrypt` est délibérément coûteuse en mémoire et en temps, ce qui rend
 * l'attaque hors ligne inintéressante même si la base fuite.
 *
 * Le sel est propre à chaque PIN : sans lui, deux membres qui choisissent
 * « 1234 » auraient la même empreinte, et une seule attaque les ouvrirait tous.
 */
export function hashPin(pin: string): string {
  const sel = randomBytes(16)
  const derive = scryptSync(pin, sel, 64)
  return `${sel.toString('hex')}:${derive.toString('hex')}`
}

export function verifyPin(pin: string, empreinte: string): boolean {
  const [selHex, attendu] = empreinte.split(':')
  if (!selHex || !attendu) return false

  const derive = scryptSync(pin, Buffer.from(selHex, 'hex'), 64)
  const attenduBuf = Buffer.from(attendu, 'hex')

  if (derive.length !== attenduBuf.length) return false
  return timingSafeEqual(derive, attenduBuf)
}
