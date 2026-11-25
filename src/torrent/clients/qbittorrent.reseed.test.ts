import { describe, expect, it, vi } from 'vitest'
import { qBittorrentController } from './qbittorrent.controller.js'

describe('qBittorrent save path', () => {
	const make = (categorySavePath: string) => {
		const controller = new qBittorrentController({
			baseUrl: 'http://localhost',
			username: '',
			password: '',
		})
		;(controller as any).client = {
			getCategories: vi
				.fn()
				.mockResolvedValue({ onepacerr: { savePath: categorySavePath } }),
			getDefaultSavePath: vi.fn().mockResolvedValue('/downloads'),
		}
		return controller
	}

	it('Resolves a relative category path against the default save path', async () => {
		expect(await make('onepacerr').getSavePath('onepacerr')).toBe(
			'/downloads/onepacerr',
		)
	})

	it('Keeps an absolute category path', async () => {
		expect(await make('/data/op').getSavePath('onepacerr')).toBe('/data/op')
	})

	it('Falls back to the default save path', async () => {
		expect(await make('').getSavePath('onepacerr')).toBe('/downloads')
	})
})

describe('qBittorrent reseed add', () => {
	const info = {
		CRC32: 'ABCD1234',
		hash: 'abcdef',
		magnetURI: 'magnet:?xt=urn:btih:abcdef',
		duration: 1,
	}
	const make = (version: string) => {
		const controller = new qBittorrentController({
			baseUrl: 'http://localhost',
			username: '',
			password: '',
		})
		const client = {
			listTorrents: vi.fn().mockResolvedValue([]),
			getAppVersion: vi.fn().mockResolvedValue(version),
			addMagnet: vi.fn().mockResolvedValue(true),
		}
		;(controller as any).client = client
		return { controller, client }
	}

	it('Adds running until metadata arrives, into the seed folder', async () => {
		const { controller, client } = make('v4.6.2')

		expect(await controller.addTorrent(info, 'onepacerr', '/dl')).toBe(true)
		const options = client.addMagnet.mock.calls[0][1]
		expect(options).toMatchObject({
			category: 'onepacerr',
			savepath: '/dl',
			stopCondition: 'MetadataReceived',
			tags: 'onepacerr-reseed',
		})
		expect(options.paused).toBeUndefined()
	})

	it('Refuses to reseed on qBittorrent older than 4.5', async () => {
		const { controller, client } = make('v4.4.5')

		expect(await controller.addTorrent(info, 'onepacerr', '/dl')).toBe(false)
		expect(client.addMagnet).not.toHaveBeenCalled()
	})
})
