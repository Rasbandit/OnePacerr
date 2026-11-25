import {
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import environment from '../environment.js'
import type { LibraryController } from '../library/library.controller.js'
import type { TargetLibraryFile } from '../library/library.model.js'
import type { EpisodeMetadata } from '../metadata/metadata.model.js'
import type { MetadataController } from '../metadata/metadata.controller.js'
import type { PipelineController } from '../pipeline/pipeline.controller.js'
import { Context } from '../util/context.js'
import type { ITorrentController, Torrent } from './torrent.model.js'
import { TorrentController } from './torrent.controller.js'

const CRC32 = 'ABCD1234'
const DESTINATION_NAME = 'One Pace - S01E01.mkv'
const SOURCE_NAME = `One Pace - S01E01 [${CRC32}].mkv`

describe('Torrent import', () => {
	let root: string
	let downloads: string
	let library: string
	let source: string
	let destination: string

	let controller: TorrentController
	let updatemetadata: ReturnType<typeof vi.fn>
	let updateTorrentCategory: ReturnType<typeof vi.fn>

	const torrent: Torrent = {
		hash: 'torrent-hash',
		content_path: '',
		name: SOURCE_NAME,
	}

	const episode = {
		arc: 1,
		episode: 1,
		title: 'Romance Dawn',
	} as EpisodeMetadata

	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), 'onepacerr-import-'))
		downloads = path.join(root, 'downloads')
		library = path.join(root, 'library')
		source = path.join(downloads, SOURCE_NAME)
		destination = path.join(library, DESTINATION_NAME)

		mkdirSync(downloads, { recursive: true })
		mkdirSync(library, { recursive: true })

		torrent.content_path = downloads

		environment.MOUNT_DOWNLOADS_TORRENT = ''
		environment.MOUNT_DOWNLOADS_ONEPACERR = ''
		environment.MOUNT_LIBRARY_MEDIA_SERVER = ''
		environment.MOUNT_LIBRARY_ONEPACERR = ''
		environment.LIBRARY_USE_HARDLINKS = true
		environment.PIPELINE_SKIP_DOWNLOADS = false
		environment.PIPELINE_SKIP_DOWNLOADS_IMPORTS = false

		updatemetadata = vi.fn().mockResolvedValue(undefined)
		Context.pipeline = {
			updatemetadata,
		} as unknown as PipelineController

		Context.metadata = {
			findEpisodeByCRC32: vi.fn().mockResolvedValue(episode),
			findCRC32: vi.fn().mockResolvedValue(CRC32),
		} as unknown as MetadataController

		Context.library = {
			getTargetLibraryEpisodeFile: vi.fn().mockResolvedValue({
				path: `${library}${path.sep}`,
				filename: DESTINATION_NAME,
			} as TargetLibraryFile),
		} as unknown as LibraryController

		updateTorrentCategory = vi.fn().mockResolvedValue(undefined)
		const client = {
			torrentClient: 'qbittorrent',
			updateTorrentCategory,
		} as unknown as ITorrentController

		controller = new TorrentController()
		;(controller as unknown as { client: ITorrentController }).client = client
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
		vi.clearAllMocks()
	})

	const importTorrent = () =>
		(
			controller as unknown as {
				importTorrentFiles: (torrent: Torrent) => Promise<void>
			}
		).importTorrentFiles(torrent)

	it('Does not recreate an episode that is already imported', async () => {
		writeFileSync(source, 'episode payload')
		linkSync(source, destination) // the episode was imported on a previous run
		const importedAt = statSync(destination).ctimeMs

		await importTorrent()

		expect(statSync(destination).ctimeMs).toBe(importedAt)
		expect(updatemetadata).not.toHaveBeenCalled()
		expect(updateTorrentCategory).toHaveBeenCalledWith(
			torrent,
			environment.TORRENT_CATEGORY_ONCE_COMPLETED,
		)
	})

	it('Leaves an episode on disk alone when only importing missing files', async () => {
		writeFileSync(source, 'new version')
		writeFileSync(destination, 'version on disk')

		await (
			controller as unknown as {
				importTorrentFiles: (
					t: Torrent,
					onlyIfMissing: boolean,
				) => Promise<void>
			}
		).importTorrentFiles(torrent, true)

		expect(readFileSync(destination, 'utf8')).toBe('version on disk')
		expect(updatemetadata).not.toHaveBeenCalled()
	})
})

describe('Queue download', () => {
	const info = {
		CRC32,
		hash: 'ABCDEF',
		magnetURI: 'magnet:?xt=urn:btih:abcdef',
		duration: 1,
	}
	let controller: TorrentController
	let client: Record<string, ReturnType<typeof vi.fn> | string>
	let importTorrentFiles: ReturnType<typeof vi.fn>

	beforeEach(() => {
		environment.PIPELINE_SKIP_DOWNLOADS = false
		client = {
			torrentClient: 'qbittorrent',
			getAllTorrents: vi.fn(),
			addTorrent: vi.fn().mockResolvedValue(true),
		}
		controller = new TorrentController()
		;(controller as unknown as { client: unknown }).client = client
		importTorrentFiles = vi.fn().mockResolvedValue(undefined)
		;(
			controller as unknown as { importTorrentFiles: unknown }
		).importTorrentFiles = importTorrentFiles
	})

	it('Imports a completed torrent already in the client', async () => {
		const existing = { hash: 'abcdef', content_path: '/x', progress: 1 }
		;(client.getAllTorrents as ReturnType<typeof vi.fn>).mockResolvedValue([
			existing,
		])

		expect(await controller.queueDownload(info)).toBe('already_present')
		expect(importTorrentFiles).toHaveBeenCalledWith(existing, true)
		expect(client.addTorrent).not.toHaveBeenCalled()
	})

	it('Does not throw when importing the existing torrent fails', async () => {
		;(client.getAllTorrents as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ hash: 'abcdef', content_path: '/elsewhere', progress: 1 },
		])
		importTorrentFiles.mockRejectedValue(new Error('ENOENT'))

		expect(await controller.queueDownload(info)).toBe('already_present')
	})

	it('Ignores torrents in unrelated categories', async () => {
		;(client.getAllTorrents as ReturnType<typeof vi.fn>).mockImplementation(
			async (category?: string) =>
				category
					? []
					: [{ hash: 'abcdef', content_path: '/x', progress: 1 }],
		)

		expect(await controller.queueDownload(info)).toBe('added')
		expect(importTorrentFiles).not.toHaveBeenCalled()
	})

	it('Leaves an incomplete torrent already in the client alone', async () => {
		;(client.getAllTorrents as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ hash: 'abcdef', content_path: '/x', progress: 0.5 },
		])

		expect(await controller.queueDownload(info)).toBe('already_present')
		expect(importTorrentFiles).not.toHaveBeenCalled()
	})
})
