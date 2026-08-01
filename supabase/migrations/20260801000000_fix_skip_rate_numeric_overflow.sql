-- skip_rate était en numeric(5,4), limité à des valeurs entre -9.9999 et 9.9999.
-- Meta renvoie reels_skip_rate en pourcentage (ex: 36.2, 59.7, 76.6) — largement
-- au-dessus de cette limite, ce qui faisait échouer l'upsert entier du post en
-- "numeric field overflow" (code 22003) dès que le skip_rate dépassait 9.9999.
-- Seuls les Reels avec un skip_rate < 10 passaient silencieusement, tous les
-- autres n'étaient jamais mis à jour en base. numeric(6,2) couvre 0-9999.99,
-- largement suffisant pour un pourcentage.
alter table analytics_ig_posts_history
  alter column skip_rate type numeric(6,2);
