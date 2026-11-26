# Babbo Natale segreto

Web app italiana per i sorteggi, ospitata su GitHub Pages con iscritti e abbinamenti conservati in Supabase. Chi partecipa usa il proprio dispositivo; l’organizzatore non riceve il destinatario assegnato a ciascuno.

## Configura Supabase (una tantum)

1. Crea un progetto gratuito su [supabase.com](https://supabase.com/).
2. Nel progetto apri **SQL Editor**. Per una nuova installazione, esegui in ordine tutti i file numerati nella cartella `supabase/migrations`. Se il database era già configurato, esegui le migrazioni successive che non hai ancora applicato.
3. Dalla pagina **Project Settings → API** copia il Project URL e la chiave pubblica **anon / legacy JWT**. Non usare mai la `service_role` o una chiave segreta nel sito.
4. Inserisci URL e chiave in `static/config.js`:

   ```js
   window.SECRET_SANTA_CONFIG = {
     supabaseUrl: "https://TUO-PROGETTO.supabase.co",
     supabaseAnonKey: "LA-TUA-CHIAVE-PUBBLICA-ANON",
   };
   ```

   La chiave `anon` è visibile agli utenti del sito per definizione: l’accesso è limitato dalle funzioni SQL e dalle tabelle senza accesso diretto. Non inserire mai chiavi `service_role`.
5. Salva e fai push. Il workflow pubblica il sito su GitHub Pages. In **Settings → Pages**, seleziona **GitHub Actions** come sorgente e verifica che le Actions siano abilitate.

## Come si usa

1. L’organizzatore crea il gruppo e condivide il link d’invito. Conserva privato il link del pannello organizzatore.
2. Ogni partecipante apre l’invito dal proprio telefono o computer e si iscrive. Il browser ricorda il codice su quel dispositivo, anche tra schede diverse; chi era già iscritto può aprire **Già iscritto?** sul link d’invito e inserire il codice personale per collegare il proprio accesso.
3. Quando ci sono almeno due iscritti, l’organizzatore avvia il sorteggio dal pannello. Riaprendo il link d’invito sul dispositivo usato per iscriversi, apparirà un pulsante per aprire il proprio abbinamento. In alternativa, apri il link personale e inserisci il codice salvato.
4. L’organizzatore può rimuovere un singolo partecipante finché le iscrizioni sono aperte. **Azzera e riparti** elimina tutti gli iscritti e i risultati, riaprendo le iscrizioni. I link di invito e organizzatore restano validi.

Non è previsto l’invio automatico di email: il sito non raccoglie indirizzi email. Ogni partecipante riceve il link al proprio risultato dopo l’iscrizione; può salvarlo e tornare ad aprirlo quando il sorteggio è pronto.

## Privacy e limiti

Supabase conserva i dati condivisi e le chiavi private dei partecipanti **cifrate** con il rispettivo codice personale; ogni assegnazione è cifrata per il partecipante destinatario. Le tabelle non consentono accesso diretto tramite la chiave pubblica del sito: le funzioni SQL verificano i link privati, i codici e l’identità del partecipante. L’organizzatore può vedere il gruppo e gli iscritti, ma il pannello non mostra gli abbinamenti.

Il link organizzatore e il link d’invito sono credenziali: chi li riceve può usare le funzioni che autorizzano. Non condividere il link organizzatore. Chi controlla il browser o modifica il codice JavaScript del sorteggio può ispezionare ciò che quel browser elabora; per verificabilità indipendente servirebbe un protocollo di sorteggio distribuito.

Supabase è un servizio esterno: i nomi e i dati cifrati risiedono nel progetto scelto. Il piano gratuito ha limiti e politiche di conservazione che dipendono da Supabase. Esegui backup se vuoi conservare lo storico.

## Verifiche locali

Richiede Node.js 20 o successivo; non servono dipendenze aggiuntive:

```powershell
node --test tests/*.test.mjs
```

Per provare il sito in locale:

```powershell
python -m http.server 8000
```

Apri <http://localhost:8000>. Le API crittografiche del browser funzionano su localhost e su GitHub Pages via HTTPS.
