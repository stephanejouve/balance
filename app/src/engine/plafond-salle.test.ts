import { describe, expect, it } from 'vitest'
import type { Groupe, MembreGroupe, PosteCherche, Salle } from '../domain/model'
import { analyserPlafondSalle, plusGrandeJaugeActive } from './plafond-salle'

function membre(personne_id: string, pupitre: MembreGroupe['pupitre']): MembreGroupe {
  return { personne_id, pupitre }
}

function poste(pupitre: PosteCherche['pupitre'], nb: number): PosteCherche {
  return { pupitre, nb }
}

function salle(id: string, jauge: number, actif = true): Salle {
  return { id, nom: id, jauge, equipement: [], restrictions: [], actif }
}

function groupe(
  membres: MembreGroupe[],
  postes_cherches: PosteCherche[] = [],
): Pick<Groupe, 'membres' | 'postes_cherches'> {
  return { membres, postes_cherches }
}

describe('plusGrandeJaugeActive', () => {
  it('retourne la plus grande jauge parmi les salles actives', () => {
    expect(plusGrandeJaugeActive([salle('A', 8), salle('B', 12), salle('C', 5)])).toBe(12)
  })

  it('ignore les salles inactives', () => {
    expect(plusGrandeJaugeActive([salle('A', 8), salle('B', 20, false), salle('C', 5)])).toBe(8)
  })

  it('retourne 0 si aucune salle active', () => {
    expect(plusGrandeJaugeActive([salle('A', 8, false)])).toBe(0)
    expect(plusGrandeJaugeActive([])).toBe(0)
  })
})

describe('analyserPlafondSalle', () => {
  const jauge = 10

  describe('effectif_actuel — comptage des personnes distinctes', () => {
    it('compte 1 personne pour Marc basse+chant sur le même morceau', () => {
      const g = groupe([membre('marc', 'basse'), membre('marc', 'chant')])
      expect(analyserPlafondSalle(g, jauge).effectif_actuel).toBe(1)
    })

    it('compte N personnes pour N musiciens distincts', () => {
      const g = groupe([
        membre('marie', 'chant'),
        membre('pierre', 'guitare'),
        membre('lea', 'basse'),
      ])
      expect(analyserPlafondSalle(g, jauge).effectif_actuel).toBe(3)
    })

    it('groupe vide → effectif_actuel = 0', () => {
      expect(analyserPlafondSalle(groupe([]), jauge).effectif_actuel).toBe(0)
    })
  })

  describe('effectif_max_potentiel — somme des `nb` de postes_cherches', () => {
    it('ajoute la somme des `nb` de tous les postes cherches', () => {
      const g = groupe([membre('marie', 'chant')], [poste('vents', 2), poste('guitare', 3)])
      expect(analyserPlafondSalle(g, jauge).effectif_max_potentiel).toBe(1 + 2 + 3)
    })

    it('aucun cherché → effectif_max_potentiel = effectif_actuel', () => {
      const g = groupe([membre('marie', 'chant'), membre('pierre', 'guitare')])
      const r = analyserPlafondSalle(g, jauge)
      expect(r.effectif_max_potentiel).toBe(r.effectif_actuel)
    })
  })

  describe('trois états CD msg 6582', () => {
    it('ok — effectif actuel et max tiennent dans la jauge', () => {
      const g = groupe(
        [membre('marie', 'chant'), membre('pierre', 'guitare'), membre('lea', 'basse')],
        [poste('batterie', 1)],
      )
      const r = analyserPlafondSalle(g, jauge)
      expect(r.etat).toBe('ok')
      expect(r.effectif_actuel).toBe(3)
      expect(r.effectif_max_potentiel).toBe(4)
    })

    it('ne_logera_plus — effectif actuel ≤ jauge, mais actuel + cherches > jauge', () => {
      // 8 membres distincts + 3 cherchés = 11 > 10, mais 8 ≤ 10
      const membres = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => membre(id, 'chant'))
      const g = groupe(membres, [poste('vents', 3)])
      const r = analyserPlafondSalle(g, jauge)
      expect(r.etat).toBe('ne_logera_plus')
      expect(r.effectif_actuel).toBe(8)
      expect(r.effectif_max_potentiel).toBe(11)
    })

    it('ne_loge_pas — effectif actuel dépasse déjà la jauge', () => {
      // 11 membres, jauge 10 → fait établi
      const membres = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].map((id) =>
        membre(id, 'chant'),
      )
      const g = groupe(membres)
      const r = analyserPlafondSalle(g, jauge)
      expect(r.etat).toBe('ne_loge_pas')
      expect(r.effectif_actuel).toBe(11)
    })

    it('ne_loge_pas prime sur ne_logera_plus quand les deux seraient vrais', () => {
      // Effectif déjà au-dessus + cherches en plus — c'est un fait, pas un risque
      const membres = Array.from({ length: 12 }, (_, i) => membre(`p${i}`, 'chant'))
      const g = groupe(membres, [poste('vents', 2)])
      expect(analyserPlafondSalle(g, jauge).etat).toBe('ne_loge_pas')
    })

    it('exactement à la jauge → ok', () => {
      // Frontière : effectif = jauge, pas de dépassement
      const membres = Array.from({ length: jauge }, (_, i) => membre(`p${i}`, 'chant'))
      expect(analyserPlafondSalle(groupe(membres), jauge).etat).toBe('ok')
    })

    it('effectif_max exactement à la jauge → ok', () => {
      const membres = Array.from({ length: 8 }, (_, i) => membre(`p${i}`, 'chant'))
      const g = groupe(membres, [poste('vents', 2)])
      expect(analyserPlafondSalle(g, jauge).etat).toBe('ok')
    })
  })

  describe('cas limite jauge = 0 (aucune salle active)', () => {
    it('groupe non vide → ne_loge_pas', () => {
      const g = groupe([membre('marie', 'chant')])
      expect(analyserPlafondSalle(g, 0).etat).toBe('ne_loge_pas')
    })

    it('groupe vide → ok', () => {
      expect(analyserPlafondSalle(groupe([]), 0).etat).toBe('ok')
    })
  })

  describe('cohérence personnes vs postes (invariant CD 6542)', () => {
    it("Marc basse+chant sur un morceau à 10 places tient (1 personne), pas 2", () => {
      // Sans le comptage distinct, on aurait 11 postes → faux positif ne_loge_pas
      const membres = [
        ...Array.from({ length: 9 }, (_, i) => membre(`p${i}`, 'chant')),
        membre('marc', 'basse'),
        membre('marc', 'chant'),
      ]
      const r = analyserPlafondSalle(groupe(membres), jauge)
      expect(r.effectif_actuel).toBe(10) // 9 distincts + marc = 10 personnes
      expect(r.etat).toBe('ok')
    })
  })
})
