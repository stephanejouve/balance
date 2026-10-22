/**
 * #179 (arbitrage CD 2026-10-22, les deux mesures ensemble) :
 * 1. une règle créée par « + règle » n'a AUCUN champ prérempli — l'ancien
 *    début 09:00 retirait le créneau de 9h toute la session sur un simple
 *    clic, sans rien dire ;
 * 2. toute règle active dit ce qu'elle bloque, en permanence — pas
 *    seulement sur transition (#160).
 */
import { flushSync, mount, unmount } from 'svelte'
import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Lieu, Session, type Indispo, type Personne } from '../domain/model'
import { indispoBloque, indispoVierge, raisonIndispoIgnoree } from '../engine/indispo'
import Indispos from './Indispos.svelte'

const lieu = Lieu.parse({ id: 'l', nom: 'l', salles: [{ id: 's', nom: 's', jauge: 10 }] })
const session = Session.parse({
  id: 's', nom: 'n', lieu_id: 'l', date_debut: '2026-08-24', date_fin: '2026-08-28', date_butoir: '2026-08-28',
  grille: [{ debut: '09:00', fin: '11:59', pas_minutes: 60 }],
})
const creneaux = genererCreneaux(session, lieu)
const pers = (ind: Indispo) =>
  ({ id: 'p', nom: 'Léa', discriminant: '', instruments: [], role: 'musicien', indispos: [ind] }) as unknown as Personne

describe('indispoVierge — un clic sur « + règle » ne bloque rien, et le dit', () => {
  it('aucun champ prérempli : ni jour, ni début, ni durée, ni rôle', () => {
    const v = indispoVierge()
    expect(v.jours).toEqual([])
    expect(v.debut).toBeUndefined()
    expect(v.duree_minutes).toBeUndefined()
    expect(v.roles).toEqual([])
  })

  it('elle ne bloque AUCUN créneau de la session, et sa raison le dit (garde-fou)', () => {
    const v = indispoVierge()
    expect(creneaux.some((c) => indispoBloque(pers(v), c, []))).toBe(false)
    expect(raisonIndispoIgnoree(v)).toMatch(/^Aucun jour, horaire ni rôle renseigné — la règle ne bloque rien/)
  })

  it('contre-exemple : l\'ancienne règle neuve (début 09:00 prérempli) bloquait 9h tous les jours', () => {
    const ancienne = { ...indispoVierge(), debut: '09:00' } as Indispo
    const bloques = creneaux.filter((c) => indispoBloque(pers(ancienne), c, []))
    expect(bloques.map((c) => c.debut)).toEqual(Array(5).fill('09:00'))
  })
})

describe('Indispos.svelte — la portée de toute règle active est affichée', () => {
  function rendre(indispos: Personne['indispos']) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const personnes = $state([{ id: 'p', nom: 'Léa', discriminant: '', instruments: [], role: 'musicien', indispos } as Personne])
    const c = mount(Indispos, {
      target: container,
      props: {
        personnesAvecIndispo: personnes, personnesSansIndispo: [], nbIndispoTotal: indispos.length,
        onAjouterIndispo: () => {}, onSupprimerIndispo: () => {}, onInvalider: () => {},
        joursSession: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'],
      },
    })
    flushSync()
    return { container, c }
  }

  it('règle active d\'origine (aucune transition) : « Bloque : … », sans « compte maintenant »', () => {
    const { container, c } = rendre([{ jours: ['2026-08-25'], roles: [], motif: 'RDV médecin' }])
    expect(container.querySelector('.indispo-portee')!.textContent).toBe('Bloque : 25/08/2026, toute la journée.')
    expect(container.textContent).not.toContain('compte maintenant')
    unmount(c)
  })

  it('une règle héritée du 09:00 prérempli devient lisible : « Bloque : tous les jours de la session, le créneau de 09:00. »', () => {
    const { container, c } = rendre([{ jours: [], debut: '09:00', roles: [], motif: '', saisie_editeur: true }])
    expect(container.querySelector('.indispo-portee')!.textContent).toBe('Bloque : tous les jours de la session, le créneau de 09:00.')
    unmount(c)
  })

  it('règle vierge : « Ignorée », pas de ligne de portée', () => {
    const { container, c } = rendre([indispoVierge()])
    expect(container.querySelector('.indispo-ignoree')!.textContent).toMatch(/Aucun jour, horaire ni rôle renseigné/)
    expect(container.querySelector('.indispo-portee')).toBeNull()
    unmount(c)
  })
})
