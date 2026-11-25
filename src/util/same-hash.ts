/** Torrent info-hashes are hex; clients and metadata disagree on case */
export default function sameHash(a?: string, b?: string): boolean {
	return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}
