# RH360 — front end (Next.js + Tailwind + Supabase)

Application RH de NotionCall : connexion par identifiant, menu selon le rôle, demandes, calendrier,
documents, Mes RDV, validations, absences & retards, salariés & accès, stats RDV, paie, rapports,
paramètres, utilisateurs & rôles. Toute la sécurité est dans la base (RLS) : le site n'affiche que
ce que le rôle a le droit de voir.

## 1. Finir la base (une seule fois)
Projet Supabase : **Notioncall_center** (`iiqxqanrtoxhllqypibw`). L'ancien projet `rh360`
(`gtnmgbswsnoatnyzfogj`) n'existe plus.

`rh360_suite.sql` n'est appliqué que jusqu'à la ligne 993. Les lignes 994-1001 ont été passées
séparément (`profiles.id` découplé de `auth.users`, colonnes `account_status` /
`account_created_at`, `email` rendu nullable). **Il reste les lignes 1002-1145 à passer** :
fonctions `on_auth_user_deleted`, `protect_account_status`, `rekey_profile`, `attach_account`,
la vue `employees_access` et le seed des salariés.

Le fichier prêt à coller est **`../rh360_fin_deux_super_admins.sql`** : même contenu, avec le
`revoke` sur `rdv_resolve_rows` rendu conditionnel (la fonction n'existe pas sur ce projet et
faisait échouer le script) et le seed réduit à deux fiches. Ouvrez Supabase → **SQL Editor** →
*New query*, collez tout, **Run**.

Tant que ce n'est pas fait, les écrans **Rapports** et **Salariés** échouent : ils interrogent
la vue `employees_access`, qui n'existe pas encore.

Edge Functions : `login` est déployée (`verify_jwt` à **false**, obligatoire — la clé publique
est une `sb_publishable_…`, pas un JWT). `create-access` **n'est pas écrite**.
`change-password` est écrite (`supabase/functions/change-password/`) mais pas déployée.

## 2. Créer votre compte super admin
Créez **toujours** le compte depuis le dashboard, jamais par `insert into auth.users` : une ligne
fabriquée à la main laisse des colonnes de jetons à `NULL` et GoTrue refuse alors la connexion
avec `500 "Database error querying schema"`.

1. Supabase → **Authentication → Users → Add user → Create new user** : votre e-mail + un mot de passe,
   cochez *Auto confirm user*.
2. SQL Editor (nécessite les lignes 1002-1145 de l'étape 1) :
   ```sql
   select public.attach_account('aymane', 'votre@email.com');
   ```
3. Connectez-vous sur le site avec l'identifiant **aymane** et ce mot de passe.

État actuel : la fiche `aymane` (matricule A74, `super_admin`) existe en base, mais sa ligne
`auth.users` a été créée à la main et est inutilisable — à supprimer et recréer via le dashboard,
puis rattacher la fiche au nouvel id.

Les salariés sans adresse e-mail réelle se connectent par identifiant seul : Supabase exige un
e-mail interne, qu'ils ne voient ni ne saisissent jamais. Ils n'ont alors **pas** de
réinitialisation par e-mail — seul un super admin peut les débloquer, et cet écran reste à écrire
(aucun bouton de réinitialisation dans **Salariés** aujourd'hui). Donnez une vraie adresse à
chaque super admin, sinon plus personne ne peut rien débloquer sans passer par le dashboard.

Ensuite tout se fait depuis le site : **Salariés → Créer tous les accès manquants** génère un
identifiant + mot de passe provisoire par personne (à remettre en main propre ; changement forcé à
la 1re connexion).

## 3. Lancer en local
```bash
npm install
cp .env.local.example .env.local   # URL + clé publique du projet Notioncall_center
npm run dev                         # http://localhost:3000
```

## 4. Mettre en ligne (Vercel, gratuit)
1. Poussez ce dossier sur GitHub.
2. vercel.com → *Add New Project* → importez le repo (framework détecté : Next.js).
3. *Environment Variables* : `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   (valeurs de `.env.local.example`). → **Deploy**.
   Les deux sont obligatoires : `lib/supabase.ts` lève une erreur si l'une manque, donc le build
   Vercel échoue plutôt que de livrer un site qui renvoie 401 sur chaque requête.
4. Supabase → Authentication → URL Configuration : mettez l'URL Vercel dans *Site URL*.

La clé utilisée est la clé **publique** (publishable) : elle peut être dans le navigateur.
Ne mettez jamais la clé `service_role` dans ce projet.

## Structure
- `app/login`, `app/mot-de-passe` — connexion par identifiant (Edge Function `login`), changement forcé
- `app/(app)/layout.tsx` — menu construit depuis `my_access()`, notifications, badge validations
- `app/(app)/<module>/page.tsx` — un écran par module (`accueil`, `demandes`, `calendrier`, `documents`,
  `mesrdv`, `profil`, `validations`, `pointage`, `salaries`, `stats`, `paie`, `rapports`, `parametres`, `admin`)
- `lib/session.tsx` — session, profil, droits (`can(module, edit)`)
- `components/` — UI (cartes, modales, toasts), bulletin de paie, changement de salaire

## Testé
`next build` OK, puis parcours complet sur une copie locale de la base (PostgREST) : connexion,
mot de passe forcé, demande de congé → validation manager → validation RH, déclaration de retard,
changement de salaire, création de fiche + accès, ouverture/calcul/validation de la paie,
consultation du bulletin par le salarié. Aucune erreur.

⚠️ Taux de paie (CNSS, AMO, IR, frais pro) : à faire valider par votre expert-comptable.
# rhnc
