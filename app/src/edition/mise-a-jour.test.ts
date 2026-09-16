import { describe, expect, it, vi } from 'vitest'
import {
  detecterMiseAJour,
  estDismissee,
  lireManifestDistant,
  marquerDismissee,
  preparerEtatMaJPathSW,
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

describe('preparerEtatMaJPathSW — SW updatefound sans divergence de version (CD 6980)', () => {
  // Bug rapporté par l'agent navigateur le 15/09 : sur `e64210d`, le
  // MàJ bandeau affichait « Nouvelle version v20260916.0009 installée
  // en tâche de fond — tu utilises v20260916.0009. Recharger. » Comparait
  // une version à elle-même. Cause : le Path SW ne comparait pas les
  // versions AVANT d'afficher. Le SW `updatefound` fire quand le fichier
  // `sw.js` change byte-à-byte, PAS forcément quand `__APP_VERSION__`
  // change. Un rebuild qui touche le SW sans bumper la version
  // provoquait le faux positif. Reload = destructeur (cf PR #140), donc
  // clic accidentel = perte de travail.

  it('version distante == locale → null (verrou de non-régression)', async () => {
    // Le cœur du fix : ne pas afficher quand les versions sont égales.
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '20260916.0009' }),
    } as unknown as Response)
    const etat = await preparerEtatMaJPathSW(
      '20260916.0009',
      'http://x/balance.html',
      fetcher as unknown as typeof fetch,
    )
    expect(etat).toBeNull()
  })

  it('version distante > locale → EtatMiseAJour.nouvelle-version avec installee_en_tache_de_fond', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '20260917.0800' }),
    } as unknown as Response)
    const etat = await preparerEtatMaJPathSW(
      '20260916.0009',
      'http://x/balance.html',
      fetcher as unknown as typeof fetch,
    )
    expect(etat).not.toBeNull()
    expect(etat!.statut).toBe('nouvelle-version')
    if (etat!.statut === 'nouvelle-version') {
      expect(etat!.version_locale).toBe('20260916.0009')
      expect(etat!.version_distante).toBe('20260917.0800')
      expect(etat!.installee_en_tache_de_fond).toBe(true)
      expect(etat!.url_telechargement).toBe('http://x/balance.html')
    }
  })

  it('version distante < locale (rollback improbable) → null', async () => {
    // Défense en profondeur : si le manifest sert une version plus
    // ancienne (miroir mal synchronisé, rollback), on ne prompt pas
    // pour un downgrade.
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '20260915.0000' }),
    } as unknown as Response)
    const etat = await preparerEtatMaJPathSW(
      '20260916.0009',
      'http://x/balance.html',
      fetcher as unknown as typeof fetch,
    )
    expect(etat).toBeNull()
  })

  it('manifest introuvable (fetch fail) → null', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network'))
    const etat = await preparerEtatMaJPathSW(
      '20260916.0009',
      'http://x/balance.html',
      fetcher as unknown as typeof fetch,
    )
    expect(etat).toBeNull()
  })
})
