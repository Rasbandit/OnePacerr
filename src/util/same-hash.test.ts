import { describe, expect, it } from 'vitest'
import sameHash from './same-hash.js'

describe('Same hash', () => {
	it('Ignores case', () => expect(sameHash('ABcd', 'abCD')).toBe(true))
	it('Rejects different hashes', () => expect(sameHash('ab', 'ac')).toBe(false))
	it('Rejects missing hashes', () =>
		expect(sameHash(undefined, undefined)).toBe(false))
})
