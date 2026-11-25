import {
	QBittorrent,
	Torrent as qbTorrent,
	TorrentCategories,
} from '@ctrl/qbittorrent'
import { Logger } from 'ez-ts-logger'
import path from 'node:path'
import environment from '../../environment.js'
import { FileMetadata } from '../../metadata/metadata.model.js'
import sameHash from '../../util/same-hash.js'
import {
	ITorrentController,
	RESEED_TAG,
	Torrent,
	TorrentClient,
	TorrentConnectionError,
} from '../torrent.model.js'

export class qBittorrentController implements ITorrentController {
	readonly torrentClient: TorrentClient = 'qbittorrent'
	private client: QBittorrent

	constructor(
		private configs: {
			baseUrl: string
			username: string
			password: string
		},
	) {
		this.client = new QBittorrent({
			...configs,
			timeout: environment.TORRENT_CLIENT_TIMEOUT,
		})
	}

	public async addTorrent(
		torrentInfo: FileMetadata,
		category: string,
		reseedSavePath?: string,
	): Promise<boolean> {
		let torrent = (await this.getAllTorrents()).find(t =>
			sameHash(t.hash, torrentInfo.hash),
		)
		if (torrent) {
			Logger.debug(`MagnetURI already in qBittorrent...`)
			if (torrent.category == category || !environment.TORRENT_CATEGORY_FORCE)
				return false
			else {
				Logger.debug(`Forcing category change...`)
				await this.updateTorrentCategory({ hash: torrent.hash }, category)
			}
		} else if (reseedSavePath) {
			// stopCondition needs 4.5+, older versions would download into the seed link
			let version = (await this.client.getAppVersion()).replace(/^v/, '')
			if (version.localeCompare('4.5', undefined, { numeric: true }) < 0) {
				Logger.warn(`Reseeding needs qBittorrent 4.5 or newer...`)
				return false
			}
			return await this.client.addMagnet(torrentInfo.magnetURI, {
				category,
				savepath: reseedSavePath,
				useAutoTMM: 'false',
				stopCondition: 'MetadataReceived',
				tags: RESEED_TAG,
			} as Parameters<QBittorrent['addMagnet']>[1])
		} else {
			return await this.client.addMagnet(torrentInfo.magnetURI, { category })
		}
	}

	public async getSavePath(category: string): Promise<string> {
		const categoryPath = (await this.client.getCategories())[category]?.savePath
		const defaultPath = await this.client.getDefaultSavePath()
		if (!categoryPath) return defaultPath
		// qBittorrent resolves a relative category path against the default one
		return path.isAbsolute(categoryPath) || path.win32.isAbsolute(categoryPath)
			? categoryPath
			: path.join(defaultPath, categoryPath)
	}

	public async startTorrent(hash: string) {
		await this.client.startTorrent(hash)
	}

	public async recheckTorrent(hash: string) {
		await this.client.recheckTorrent(hash)
	}

	public async removeTorrent(hash: string, deleteFiles: boolean) {
		await this.client.removeTorrent(hash, deleteFiles)
	}

	public async getAllTorrents<T = Torrent>(category?: string): Promise<T[]> {
		try {
			return (await this.client.listTorrents({ category })) as T[]
		} catch (e: any) {
			Logger.error(`Could not connect to qBittorrent: ${e.message}`)
			if (e instanceof Error) throw e
			else throw new TorrentConnectionError()
		}
	}

	public async getCompletedTorrents<T = Torrent>(
		category?: string,
	): Promise<T[]> {
		return ((await this.getAllTorrents<qbTorrent>()) as qbTorrent[]).filter(
			t => (!category || t.category == category) && t.progress >= 1,
		) as T[]
	}

	public async updateTorrentCategory(
		torrent: Partial<Torrent>,
		category: string,
	): Promise<void> {
		try {
			await this.client.setTorrentCategory(torrent.hash, category)
		} catch (e) {
			let categories: TorrentCategories = await this.client.getCategories()

			if (!categories[category]) {
				Logger.debug(`Creating '${category}' qBittorrent category`)
				await this.client.createCategory(category)
			}
			await this.client.setTorrentCategory(torrent.hash, category)
		}
	}
}
