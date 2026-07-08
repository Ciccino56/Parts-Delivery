# Ricambi Delivery

Prototipo mobile-first per tracciare consegne ricambi tra negozio, rider e cliente.

## Come provarla

Apri `index.html` nel browser.

Ordini demo:

- `ORD-1024`
- `ORD-1025`
- `ORD-1026`

## Cosa fa

- Accesso cliente dimostrativo con nome e telefono.
- Accesso rider con PIN demo `2222`.
- Accesso negozio con PIN demo `9999`.
- Vista cliente con ricerca per numero ordine.
- Vista rider con avanzamento stato consegna.
- Vista negozio per creare ordini, copiare il link cliente e aprire WhatsApp con messaggio pronto.
- Stati consegna: da ritirare, ritirato, in consegna, sta arrivando, consegnato.
- Mappa dimostrativa con avanzamento visivo del rider.
- Dati salvati nel browser per provare il flusso senza server.
- Schema iniziale Supabase in `supabase-schema.sql`.

## Prossimo passo per usarla davvero

Per metterla in produzione servono:

- database condiviso, per esempio Supabase o Firebase;
- login rider;
- pannello negozio protetto;
- posizione GPS reale del rider durante la consegna;
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
