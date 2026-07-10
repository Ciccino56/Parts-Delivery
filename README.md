# Ricambi Delivery

Prototipo mobile-first per tracciare consegne ricambi tra negozio, rider e cliente.

## Come provarla

Apri `index.html` nel browser.

Quando GitHub Pages e attivo, l'app pubblica sara:

`https://ciccino56.github.io/Parts-Delivery/`

Ordini demo:

- `ORD-1024`
- `ORD-1025`
- `ORD-1026`

## Cosa fa

- Accesso cliente dimostrativo con nome e telefono.
- Accesso cliente limitato a numero ordine + telefono associato.
- Accesso rider con PIN separati: Marco `2222`, Luca `3333`, Antonio `4444`, Salvatore `5555`.
- Accesso negozio con email e password Supabase.
- Vista cliente con ricerca per numero ordine.
- Vista rider con avanzamento stato consegna.
- Vista negozio per creare ordini, copiare il link cliente e aprire WhatsApp con messaggio pronto.
- Banco negozio con ricerca, filtri per stato, modifica ordine e annullamento.
- Stati consegna: da ritirare, ritirato, in consegna, sta arrivando, consegnato.
- Mappa reale OpenStreetMap con posizione GPS del rider quando attiva.
- Pulsante rider `Condividi GPS` per inviare la posizione in tempo reale al cliente.
- Percorso stimato e ETA tra posizione rider e indirizzo cliente.
- Dati salvati nel browser per provare il flusso senza server.
- Schema iniziale Supabase in `supabase-schema.sql`.
- Migrazione accesso negozio in `supabase-shop-auth.sql`.
- Migrazione accessi separati in `supabase-access-v3.sql`.

## Prossimo passo per usarla davvero

Per metterla in produzione servono:

- database condiviso, per esempio Supabase o Firebase;
- login rider;
- pannello negozio protetto;
- notifiche automatiche quando il rider parte o sta arrivando;
- link cliente inviabile via WhatsApp o SMS;
- dominio pubblico HTTPS.

## Collegamento Supabase

Il progetto Supabase previsto e:

`https://hzpsuuruaxzkgonqejkb.supabase.co`

Per collegare l'app:

1. In Supabase apri SQL Editor.
2. Esegui `supabase-schema.sql`.
3. Se avevi gia eseguito una versione vecchia dello schema, esegui anche `supabase-update-v2.sql`.
4. Vai in Project Settings, poi API.
5. Copia la `anon public key`.
6. Incollala in `config.js` al posto di `INCOLLA_QUI_LA_ANON_PUBLIC_KEY`.

Le istruzioni `claude mcp add` servono a collegare Supabase a Claude. Per questa app non sono obbligatorie.
