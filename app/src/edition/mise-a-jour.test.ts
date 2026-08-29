import { describe, expect, it, vi } from 'vitest'
import {
  detecterMiseAJour,
  estDismissee,
  lireManifestDistant,
  marquerDismissee,
  versionEstPlusRecente,
  type Manifest,
} from './mise-a-jour'

describe('versionEstPlusRecente', () => {
  it('détecte une version postérieure au format timestamp', () => {
    expect(versionEstPlusRecente('20260830.1200', '20260829.1500')).toBe(true)
    expect(versionEstPlusRecente('20260829.1600', '20260829.1500')).toBe(true)
  })
  it('renvoie false si égalité', () => {
    expect(versionEstPlusRecente('20260829.1500', '20260829.1500')).toBe(false)
  })
  it('renvoie false si distante < locale', () => {
    expect(versionEstPlusRecente('20260828.2359', '20260829.0000')).toBe(false)
  })
})

describe('lireManifestDistant', () => {
  it('retourne le manifest si réponse ok + json valide', async () => {
    const manifest: Manifest = { version: '20260829.2130', built_at: '...' }
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => manifest,
    } as unknown as Response)
    const result = await lireManifestDistant(fetcher as unknown as typeof fetch, 'http://x')
    expect(result).toEqual(manifest)
  })

  it('retourne null si HTTP != 2xx', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false } as Response)
    expect(await lireManifestDistant(fetcher as unknown as typeof fetch, 'http://x')).toBeNull()
  })

  it('retourne null si version absente', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ built_at: 'x' }),
    } as unknown as Response)
    expect(await lireManifestDistant(fetcher as unknown as typeof fetch, 'http://x')).toBeNull()
  })

  it('retourne null si le fetch throw (offline transitoire, timeout, etc.)', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network'))
    expect(await lireManifestDistant(fetcher as unknown as typeof fetch, 'http://x')).toBeNull()
  })
})

describe('estDismissee / marquerDismissee', () => {
  function stockage(): Storage {
    const bak: Record<string, string> = {}
    return {
      getItem: (k) => bak[k] ?? null,
      setItem: (k, v) => { bak[k] = v },
      removeItem: (k) => { delete bak[k] },
      clear: () => { for (const k of Object.keys(bak)) delete bak[k] },
      key: () => null,
      length: 0,
    } as Storage
  }

  it('marque puis reconnaît', () => {
    const s = stockage()
    marquerDismissee('v1', s)
    expect(estDismissee('v1', s)).toBe(true)
    expect(estDismissee('v2', s)).toBe(false)
  })

  it('re-marquer écrase (une seule version dismissée à la fois)', () => {
    const s = stockage()
    marquerDismissee('v1', s)
    marquerDismissee('v2', s)
    expect(estDismissee('v1', s)).toBe(false)
    expect(estDismissee('v2', s)).toBe(true)
  })

  it('storage inaccessible ne throw pas', () => {
    const s = {
      getItem: () => { throw new Error('quota') },
      setItem: () => { throw new Error('quota') },
    } as unknown as Storage
    expect(() => marquerDismissee('v1', s)).not.toThrow()
    expect(estDismissee('v1', s)).toBe(false)
  })
})

describe('detecterMiseAJour', () => {
  const navigatorOnline = { onLine: true }
  const navigatorOffline = { onLine: false }

  it('offline → statut offline sans fetch', async () => {
    const fetcher = vi.fn()
    const etat = await detecterMiseAJour('20260829.1500', navigatorOffline, fetcher as unknown as typeof fetch)
    expect(etat.statut).toBe('offline')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('online + manifest introuvable → statut erreur', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('x'))
    const etat = await detecterMiseAJour('20260829.1500', navigatorOnline, fetcher as unknown as typeof fetch)
    expect(etat.statut).toBe('erreur')
  })

  it('online + version distante <= locale → statut a-jour', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '20260829.1400' }),
    } as unknown as Response)
    const etat = await detecterMiseAJour('20260829.1500', navigatorOnline, fetcher as unknown as typeof fetch)
    expect(etat.statut).toBe('a-jour')
  })

  it('online + version distante > locale → statut nouvelle-version avec urls', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '20260830.0800', download_url: 'https://ex/dl.html' }),
    } as unknown as Response)
    const etat = await detecterMiseAJour('20260829.1500', navigatorOnline, fetcher as unknown as typeof fetch)
    expect(etat.statut).toBe('nouvelle-version')
    if (etat.statut === 'nouvelle-version') {
      expect(etat.version_locale).toBe('20260829.1500')
      expect(etat.version_distante).toBe('20260830.0800')
      expect(etat.url_telechargement).toBe('https://ex/dl.html')
    }
  })

  it('fallback url_telechargement si absente du manifest', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '20260830.0800' }),
    } as unknown as Response)
    const etat = await detecterMiseAJour('20260829.1500', navigatorOnline, fetcher as unknown as typeof fetch)
    if (etat.statut === 'nouvelle-version') {
      expect(etat.url_telechargement).toContain('balance.html')
    }
  })
})
