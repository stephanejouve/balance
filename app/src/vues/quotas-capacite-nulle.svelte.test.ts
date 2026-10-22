/**
 * #154 : l'écran Quotas n'affiche plus « Infinity% » — il dit pourquoi la
 * capacité est nulle (ici : modèle sans personne, smoke CD 2026-10-22).
 */
import { flushSync, mount, unmount } from 'svelte'
import { expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session } from '../domain/model'
import Quotas from './Quotas.svelte'

it('Quotas.svelte — pupitre sans musicien : libellé, pas « Infinity% »', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const lieu = Lieu.parse({ id: 'l', nom: 'L', salles: [{ id: 'A', nom: 'A', jauge: 10 }] })
  const session = Session.parse({
    id: 's', nom: 'S', lieu_id: 'l', date_debut: '2026-08-24', date_fin: '2026-08-25', date_butoir: '2026-08-25',
    grille: [{ debut: '09:00', fin: '11:59', pas_minutes: 60 }],
  })
  const inscriptions = Inscriptions.parse({
    session_id: 's', personnes: [],
    groupes: [{ id: 'g', titre: 'G', membres: [{ personne_id: 'inconnu', pupitre: 'chant' }] }],
  })
  const c = mount(Quotas, { target: container, props: { session, inscriptions, creneaux: genererCreneaux(session, lieu) } })
  flushSync()
  const t = container.textContent ?? ''
  expect(t).not.toContain('Infinity')
  expect(t).toContain('aucun musicien à ce pupitre')
  unmount(c)
})
