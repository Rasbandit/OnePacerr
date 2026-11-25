import {
	existsSync,
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

describe('Reseed present files', () => {
	let root: string
	let downloads: string
	let libraryFile: string
	let controller: TorrentController
	let client: {
		torrentClient: string
		getAllTorrents: ReturnType<typeof vi.fn>
		addTorrent: ReturnType<typeof vi.fn>
		getSavePath: ReturnType<typeof vi.fn>
		startTorrent: ReturnType<typeof vi.fn>
		removeTorrent: ReturnType<typeof vi.fn>
		recheckTorrent: ReturnType<typeof vi.fn>
	}

	const TORRENT_NAME = `[One Pace][1] Romance Dawn 01 [1080p][${CRC32}].mkv`
	const info = {
		CRC32,
		hash: 'abcdef0123456789',
		magnetURI: `magnet:?xt=urn:btih:abcdef0123456789&dn=${encodeURIComponent(TORRENT_NAME)}`,
		duration: 1,
		partOfBundle: false,
	}

	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), 'onepacerr-reseed-'))
		downloads = path.join(root, 'downloads')
		mkdirSync(downloads, { recursive: true })
		mkdirSync(path.join(root, 'library'), { recursive: true })
		libraryFile = path.join(root, 'library', DESTINATION_NAME)
		writeFileSync(libraryFile, 'episode payload')

		environment.MOUNT_DOWNLOADS_TORRENT = ''
		environment.MOUNT_DOWNLOADS_ONEPACERR = ''
		environment.PIPELINE_SKIP_DOWNLOADS = false
		environment.PIPELINE_RESEED_PRESENT_FILES = true

		client = {
			torrentClient: 'qbittorrent',
			getAllTorrents: vi.fn().mockResolvedValue([]),
			addTorrent: vi.fn().mockResolvedValue(true),
			getSavePath: vi.fn().mockResolvedValue(downloads),
			startTorrent: vi.fn().mockResolvedValue(undefined),
			removeTorrent: vi.fn().mockResolvedValue(undefined),
			recheckTorrent: vi.fn().mockResolvedValue(undefined),
		}
		controller = new TorrentController()
		;(controller as unknown as { client: unknown }).client = client
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
		environment.PIPELINE_RESEED_PRESENT_FILES = false
		vi.clearAllMocks()
	})

	const seeded = path.join

	it('Hardlinks the library file and adds the torrent when nothing seeds it', async () => {
		expect(await controller.reseedFile(info, libraryFile)).toBe('added')

		const linked = seeded(downloads, TORRENT_NAME)
		expect(statSync(linked).ino).toBe(statSync(libraryFile).ino)
		expect(client.addTorrent).toHaveBeenCalledWith(
			info,
			environment.TORRENT_CATEGORY,
			downloads,
		)
	})

	it('Does nothing when the client already has the torrent', async () => {
		client.getAllTorrents.mockResolvedValue([{ hash: info.hash }])

		expect(await controller.reseedFile(info, libraryFile)).toBe(
			'already_present',
		)
		expect(existsSync(seeded(downloads, TORRENT_NAME))).toBe(false)
		expect(client.addTorrent).not.toHaveBeenCalled()
	})

	it('Skips bundles', async () => {
		expect(
			await controller.reseedFile({ ...info, partOfBundle: true }, libraryFile),
		).toBe('skipped')
		expect(client.addTorrent).not.toHaveBeenCalled()
	})

	it('Does nothing when the flag is off', async () => {
		environment.PIPELINE_RESEED_PRESENT_FILES = false

		expect(await controller.reseedFile(info, libraryFile)).toBe('skipped')
		expect(client.getAllTorrents).not.toHaveBeenCalled()
		expect(client.addTorrent).not.toHaveBeenCalled()
	})

	it('Skips without copying when the hardlink fails', async () => {
		client.getSavePath.mockResolvedValue(path.join(root, 'missing-dir', 'x'))
		rmSync(downloads, { recursive: true })
		writeFileSync(path.join(root, 'missing-dir'), 'not a directory')

		expect(await controller.reseedFile(info, libraryFile)).toBe('skipped')
		expect(client.addTorrent).not.toHaveBeenCalled()
	})

	it('Is not re-imported when the reseeded torrent completes', async () => {
		await controller.reseedFile(info, libraryFile)
		const importedAt = statSync(libraryFile).ctimeMs
		const updatemetadata = vi.fn()
		Context.pipeline = { updatemetadata } as unknown as PipelineController
		Context.metadata = {
			findEpisodeByCRC32: vi
				.fn()
				.mockResolvedValue({ arc: 1, episode: 1 } as EpisodeMetadata),
			findCRC32: vi.fn().mockResolvedValue(CRC32),
		} as unknown as MetadataController
		Context.library = {
			getTargetLibraryEpisodeFile: vi.fn().mockResolvedValue({
				path: `${path.join(root, 'library')}${path.sep}`,
				filename: DESTINATION_NAME,
			} as TargetLibraryFile),
		} as unknown as LibraryController
		environment.LIBRARY_USE_HARDLINKS = true
		;(
			client as unknown as { updateTorrentCategory: unknown }
		).updateTorrentCategory = vi.fn()

		await (
			controller as unknown as {
				importTorrentFiles: (t: Torrent) => Promise<void>
			}
		).importTorrentFiles({
			hash: info.hash,
			content_path: seeded(downloads, TORRENT_NAME),
		})

		expect(statSync(libraryFile).ctimeMs).toBe(importedAt)
		expect(updatemetadata).not.toHaveBeenCalled()
	})

	it('Matches the client hash case-insensitively', async () => {
		client.getAllTorrents.mockResolvedValue([{ hash: info.hash.toUpperCase() }])

		expect(await controller.reseedFile(info, libraryFile)).toBe(
			'already_present',
		)
	})

	it('Removes the seed hardlink when the client rejects the torrent', async () => {
		client.addTorrent.mockResolvedValue(false)

		expect(await controller.reseedFile(info, libraryFile)).toBe('skipped')
		expect(existsSync(seeded(downloads, TORRENT_NAME))).toBe(false)
		expect(existsSync(libraryFile)).toBe(true)
	})

	it('Returns skipped instead of throwing when the client errors', async () => {
		client.getAllTorrents.mockRejectedValue(new Error('down'))

		expect(await controller.reseedFile(info, libraryFile)).toBe('skipped')
	})

	describe('after the recheck', () => {
		const reseeding = (over: Partial<Torrent>) =>
			({
				hash: info.hash,
				content_path: seeded(downloads, TORRENT_NAME),
				tags: 'onepacerr-reseed',
				state: 'pausedDL',
				size: 15,
				progress: 0,
				...over,
			}) as Torrent
		const processReseeds = () =>
			(
				controller as unknown as { processReseeds: () => Promise<void> }
			).processReseeds()

		beforeEach(async () => {
			await controller.reseedFile(info, libraryFile)
		})

		it('Gives up on a reseed stuck without metadata for a day', async () => {
			const dayAgo = Math.floor(Date.now() / 1000) - 25 * 3600
			client.getAllTorrents.mockResolvedValue([
				reseeding({ state: 'metaDL', size: 0, added_on: dayAgo }),
			])

			await processReseeds()

			expect(client.removeTorrent).toHaveBeenCalledWith(info.hash, false)
			expect(existsSync(seeded(downloads, TORRENT_NAME))).toBe(false)
			expect(existsSync(libraryFile)).toBe(true)
		})

		it('Resumes a torrent that verified complete', async () => {
			client.getAllTorrents.mockResolvedValue([
				reseeding({ state: 'pausedUP', progress: 1 }),
			])

			await processReseeds()

			expect(client.startTorrent).toHaveBeenCalledWith(info.hash)
			expect(client.removeTorrent).not.toHaveBeenCalled()
		})

		it('Waits while metadata or checking is pending', async () => {
			client.getAllTorrents.mockResolvedValue([
				reseeding({ state: 'metaDL', size: 0 }),
				reseeding({ hash: 'other', state: 'checkingUP' }),
			])

			await processReseeds()

			expect(client.startTorrent).not.toHaveBeenCalled()
			expect(client.removeTorrent).not.toHaveBeenCalled()
			expect(client.recheckTorrent).not.toHaveBeenCalled()
		})

		it('Removes the torrent and only the hardlink when the data does not match', async () => {
			client.getAllTorrents.mockResolvedValue([reseeding({ progress: 0.4 })])

			await processReseeds() // first pass forces a recheck
			expect(client.recheckTorrent).toHaveBeenCalledWith(info.hash)
			expect(client.removeTorrent).not.toHaveBeenCalled()

			await processReseeds() // stopped under 100% after our recheck
			expect(client.removeTorrent).toHaveBeenCalledWith(info.hash, false)
			expect(client.startTorrent).not.toHaveBeenCalled()
			expect(existsSync(seeded(downloads, TORRENT_NAME))).toBe(false)
			expect(existsSync(libraryFile)).toBe(true)
		})

		it('Waits while the forced recheck runs', async () => {
			client.getAllTorrents.mockResolvedValue([reseeding({ progress: 0.4 })])
			await processReseeds()

			client.getAllTorrents.mockResolvedValue([
				reseeding({ state: 'checkingDL', progress: 0.4 }),
			])
			await processReseeds()

			expect(client.removeTorrent).not.toHaveBeenCalled()
		})

		it('Leaves a seeding torrent alone once verified', async () => {
			client.getAllTorrents.mockResolvedValue([
				reseeding({ state: 'uploading', progress: 1 }),
			])

			await processReseeds()

			expect(client.startTorrent).not.toHaveBeenCalled()
		})

		it('Never unlinks a path that is not our seed hardlink', async () => {
			const dayAgo = Math.floor(Date.now() / 1000) - 25 * 3600
			const other = path.join(downloads, 'other.mkv')
			writeFileSync(other, 'someone else')
			client.getAllTorrents.mockResolvedValue([
				// no metadata yet: content_path is the save folder itself
				reseeding({
					state: 'metaDL',
					size: 0,
					added_on: dayAgo,
					content_path: downloads,
				}),
				reseeding({ hash: 'other', added_on: dayAgo, content_path: other }),
			])

			await processReseeds()

			expect(client.removeTorrent).toHaveBeenCalledTimes(2)
			expect(existsSync(downloads)).toBe(true)
			expect(existsSync(other)).toBe(true)
		})

		it('Still imports completed torrents when the reseed pass fails', async () => {
			const c = controller as unknown as {
				__watching: boolean
				processReseeds: () => Promise<void>
				processCompletedTorrents: () => Promise<void>
				monitorLoop: () => Promise<void>
			}
			Context.pipeline = {
				isRunning: () => false,
			} as unknown as PipelineController
			c.processReseeds = vi.fn().mockRejectedValue(new Error('boom'))
			c.processCompletedTorrents = vi.fn().mockResolvedValue(undefined)

			c.__watching = true
			vi.useFakeTimers()
			try {
				await c.monitorLoop()
			} finally {
				c.__watching = false
				vi.useRealTimers()
			}

			expect(c.processCompletedTorrents).toHaveBeenCalled()
		})
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
				category ? [] : [{ hash: 'abcdef', content_path: '/x', progress: 1 }],
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
