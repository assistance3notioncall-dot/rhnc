-- Déplace le drapeau `must_change_password` de user_metadata vers app_metadata.
--
-- Pourquoi : `raw_user_meta_data` est modifiable par le salarié lui-même
-- (supabase.auth.updateUser({ data: ... })). Le changement de mot de passe forcé
-- à la première connexion pouvait donc être levé depuis la console du navigateur,
-- sans jamais remplacer le mot de passe provisoire remis en main propre.
-- `raw_app_meta_data` n'est écrivable que par la clé secrète, donc uniquement par
-- les Edge Functions.
--
-- À exécuter UNE SEULE FOIS dans SQL Editor, APRÈS :
--   1. le déploiement de l'Edge Function `change-password`
--   2. la mise à jour de `create-access` (écrire le drapeau dans app_metadata)
-- Transaction : tout ou rien.

begin;

-- 1. Report du drapeau sur les comptes qui attendent encore leur changement.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                        || jsonb_build_object('must_change_password', true)
where coalesce((raw_user_meta_data ->> 'must_change_password')::boolean, false);

-- 2. Les comptes déjà passés par le changement : drapeau explicitement à false,
--    pour que le front n'ait plus besoin du repli sur user_metadata.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                        || jsonb_build_object('must_change_password', false)
where not (raw_app_meta_data ? 'must_change_password');

-- 3. Suppression de l'ancienne copie : une seule source de vérité.
update auth.users
set raw_user_meta_data = raw_user_meta_data - 'must_change_password'
where raw_user_meta_data ? 'must_change_password';

commit;

-- Vérification : `restants_user_metadata` doit valoir 0, et `en_attente` doit
-- correspondre au nombre de salariés qui n'ont pas encore changé leur mot de passe.
select
  count(*)                                                            as comptes,
  count(*) filter (where raw_app_meta_data ? 'must_change_password')  as drapeau_pose,
  count(*) filter (where (raw_app_meta_data ->> 'must_change_password')::boolean) as en_attente,
  count(*) filter (where raw_user_meta_data ? 'must_change_password') as restants_user_metadata
from auth.users;
