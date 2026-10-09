# RH360 — NotionCall

Application RH interne de NotionCall. Connexion par identifiant, menu construit selon le rôle de
chacun : le site n'affiche que ce que la personne a le droit de voir.

## Ce que fait l'application

**Pour chaque salarié**
- **Accueil** — vue d'ensemble, notifications, soldes de congés
- **Mes demandes** — congés, attestations, avances ; suivi de l'avancement
- **Congés & calendrier** — planning de l'équipe, absences à venir
- **Documents** — attestations et documents personnels
- **Mes RDV** — rendez-vous saisis et résultats
- **Profil** — coordonnées, contrat, bulletins de paie, mot de passe

**Pour l'encadrement**
- **Validations** — demandes à approuver, par niveau (manager puis RH)
- **Absences & retards** — déclaration et suivi
- **Salariés** — fiches du personnel, contrats, rémunération, ouverture des accès
- **Stats RDV** — rendez-vous par agent, par semaine et par mois, challenges
- **Paie** — calcul des bulletins, cotisations, net à payer
- **Rapports** — effectifs, ancienneté, absences
- **Paramètres** — sociétés, sections, types de congés, barèmes
- **Utilisateurs & rôles** — comptes, attribution des rôles, droits par module, journal

## Les rôles

Chaque rôle voit et modifie un ensemble de modules défini depuis **Utilisateurs & rôles**.
Les droits sont modifiables à tout moment et s'appliquent au prochain chargement de page.

| Rôle | Portée des données |
|---|---|
| Agent brute, Confirmateur, Agent qualif, Personnel technique, Back office / PBOF | ses propres données |
| Chef d'équipe | son équipe |
| Direction, RH / Paie | toute la société |

## Lancer en local

```bash
npm install
npm run dev
```

## Structure du code

- `app/login`, `app/mot-de-passe` — connexion par identifiant, changement de mot de passe
- `app/(app)/layout.tsx` — menu, notifications, badge des validations en attente
- `app/(app)/<module>/page.tsx` — un écran par module
- `lib/session.tsx` — session, profil et droits (`can(module, edit)`)
- `components/` — cartes, modales, toasts, bulletin de paie, changement de salaire

---

⚠️ Les taux de paie (CNSS, AMO, IR, frais professionnels) doivent être validés par un
expert-comptable avant toute utilisation réelle.
