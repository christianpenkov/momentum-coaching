# CHECKPOINT v3 — Messagerie mobile iOS PWA (2026-06-04)

> Reprise dans un nouveau chat. Lis ce bloc EN PREMIER.

## ✅ ÉTAT — tout committé et poussé sur `main`

### Vocal — tout fonctionne (résolu en session)

**Root causes trouvées et corrigées :**

1. **Bucket `voice-messages` inexistant** → upload 400 "Bucket not found". Créé via Supabase MCP.
2. **Aucune RLS policy sur `storage.objects` pour `voice-messages`** → upload 403 silencieux. Policies INSERT+SELECT créées.
3. **`mr.start(100)` avec timeslice sur iOS Safari** → chunks `audio/mp4` incomplets → blob corrompu. Fix : `mr.start()` sans argument.
4. **`.select().single()` après insert** → la RLS sans `WITH CHECK` bloquait la re-lecture → `data = null` → `null` injecté dans le state → message disparaissait. Fix : supprimer le `.select()`, laisser le Realtime gérer.
5. **`REPLICA IDENTITY` = default sur table `messages`** → payload Realtime ne contenait que l'id → toutes les colonnes (`audio_url` etc.) étaient null dans le handler. Fix : `ALTER TABLE messages REPLICA IDENTITY FULL` appliqué en DB.
6. **Blob brut sans contentType** → Safari refusait de lire. Fix : `new File([blob], nom, { type: 'audio/mp4' })` + `contentType` strict à l'upload.

### Règles d'or pour les prochains vocaux

- **Toujours `mr.start()` sans timeslice** sur iOS Safari — les chunks MP4 sont corrompus sinon
- **Toujours créer le bucket AVANT les policies** — les policies sans bucket échouent silencieusement
- **Toujours `REPLICA IDENTITY FULL`** sur les tables utilisées avec Realtime Supabase
- **Jamais `.select().single()` après un insert** si la RLS n'a pas de `WITH CHECK` — retourne null et casse le state
- **`new File()` nommé + contentType strict** pour Safari iOS

### Commits clés
- `1684bbb` — RLS voice-messages + mr.start() sans timeslice
- `70566ff` — File() nommé + contentType strict
- `4cc2a52` — Supprime .select().single() qui injectait null
- `9e856cd` — Bucket voice-messages créé en DB Supabase
- `66c892c` — Fix 406 profiles (.maybeSingle)

## Prochaine étape — UX/UI messagerie

Animations à ajouter :
- Bulles messages : slide+fade à l'envoi (déjà présent `.msg-bubble-in`)
- Statuts message : envoyé / lu / vu (double coche style WhatsApp)
- Indicateur "en ligne" dynamique
- Player audio vocal custom (au lieu du `<audio>` natif gris)
- Indicateur "est en train d'écrire..."

## Infos clés projet
- Supabase : `nvjgwtetyuatnkjihmtw` (eu-west-3)
- Client test : `349de377-4bdb-4b74-97f1-c2d7590541f1`
- Buckets Storage : `voice-messages` (public), `chat-medias` (public)
- Git remote : `github.com/christianpenkov/momentum-coaching`, branche `main`
- Vercel : `momentum-plateforme` — auto-deploy sur push
