import { FileMetadata } from '../metadata/metadata.model'

export type TorrentClient =
	'qbittorrent' | 'utorrent' | 'deluge' | 'transmission'
export type QueueDownloadResult = 'added' | 'already_present' | 'skipped'
export type Torrent = {
	readonly hash: string
	readonly content_path: string
	readonly save_path?: string
	readonly name?: string
	readonly category?: string
	readonly progress?: number
	readonly state?: string
	readonly size?: number
	readonly tags?: string
	/** Unix seconds */
	readonly added_on?: number
}

export interface ITorrentController {
	readonly torrentClient: TorrentClient

	addTorrent(
		torrentInfo: FileMetadata,
		category: string,
		/** Reseed: add tagged, stopping once metadata arrives, into this folder */
		reseedSavePath?: string,
	): Promise<boolean>
	getAllTorrents(category?: string): Promise<Torrent[]>
	getCompletedTorrents(category?: string): Promise<Torrent[]>
	updateTorrentCategory(torrent: Torrent, category: string): Promise<void>

	// Reseeding support, only qBittorrent implements these
	/** Client-side folder new torrents of this category download into */
	getSavePath?(category: string): Promise<string>
	startTorrent?(hash: string): Promise<void>
	recheckTorrent?(hash: string): Promise<void>
	removeTorrent?(hash: string, deleteFiles: boolean): Promise<void>
}

/** Tag on reseeded torrents, resumed only after a full recheck */
export const RESEED_TAG = 'onepacerr-reseed'

export class TorrentConnectionError extends Error {
	constructor(message?: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = 'TorrentConnectionError'
	}
}
