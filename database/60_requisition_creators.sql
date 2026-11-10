-- ============================================================================
-- 60_requisition_creators.sql — Seuls les demandeurs (et l'administrateur) créent des réquisitions (idempotente)
-- ----------------------------------------------------------------------------
-- Choix de l'utilisateur (2026-11-10) : « quelqu'un qui n'est pas demandeur ne doit pas accéder ni voir le bouton
-- Nouvelle réquisition, à part l'administrateur ». CREATE_REQUISITIONS (création, import d'articles, correction) est
-- retiré de tout profil autre que prof_admin et prof_requester (avant : aussi les managers N1 / N2 / N3). Un manager qui
-- doit faire une demande reçoit en plus le profil Demandeur (sur le projet).
-- Instruction en début de ligne : rejouée par zz_reapply_grants.sh sur une base neuve.
-- ============================================================================

DELETE FROM profile_permissions WHERE profile_id NOT IN ('prof_admin', 'prof_requester') AND permission_id IN (SELECT id FROM permissions WHERE name = 'CREATE_REQUISITIONS');
