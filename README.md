# Babbo Natale segreto

Web app statica in italiano, pubblicabile su GitHub Pages. Non richiede un backend, un database o servizi esterni. I partecipanti possono usare dispositivi diversi scambiando manualmente file JSON.

## Flusso del sorteggio

1. L’organizzatore crea il gruppo nel proprio browser e condivide il link d’iscrizione. Il link organizzatore e i dati di gestione sono conservati nel browser usato per creare il gruppo.
2. Ogni partecipante apre il link sul proprio dispositivo, inserisce il nome e scarica il file JSON d’iscrizione. L’app mostra anche un codice personale, da conservare senza inviarlo all’organizzatore.
3. I partecipanti inviano privatamente i propri JSON all’organizzatore. Dal pannello, l’organizzatore importa uno o più file e avvia il sorteggio.
4. L’app scarica un solo JSON dei risultati, con i destinatari cifrati per i rispettivi partecipanti. L’organizzatore lo condivide con il gruppo.
5. Ogni partecipante importa quel JSON dal proprio telefono o computer e inserisce il nome e il codice personale. L’app decifra e mostra il suo destinatario, poi salva nel browser **il file cifrato**, non il nome del destinatario. Per visualizzarlo di nuovo basta riaprire la pagina del risultato e inserire il codice.

Non condividere il codice personale insieme al file d’iscrizione: file e codice devono viaggiare separatamente. I dati dei partecipanti nel JSON condiviso sono visibili, ma i destinatari sono cifrati con chiavi individuali.

## Limiti senza backend

GitHub Pages non conserva né sincronizza dati. La trasmissione dei file avviene a mano, ad esempio tramite messaggi privati o il gruppo della festa; il sito non li invia. L’organizzatore deve conservare il browser e i dati del sito su cui ha creato il gruppo. Se li cancella o cambia browser, il pannello e le iscrizioni importate non sono recuperabili senza backup.

Il pannello non mostra gli abbinamenti e il JSON protegge i risultati con cifratura a chiave pubblica. Tuttavia, senza un server fidato o un protocollo distribuito, l’estrazione avviene nel browser dell’organizzatore: una persona che controlla quel dispositivo può ispezionare o modificare l’applicazione. Non è quindi una garanzia contro un organizzatore intenzionalmente ostile o un dispositivo compromesso.

**Azzera gruppo** elimina le iscrizioni importate sul browser dell’organizzatore e apre un nuovo turno con un nuovo link d’iscrizione. Non può cancellare i file JSON già scaricati o inoltrati né revocare risultati che qualcuno ha già aperto.

## Pubblicazione su GitHub Pages

Il workflow in `.github/workflows/deploy-pages.yml` pubblica i file statici su ogni push al branch `main`.

1. Nel repository GitHub apri **Settings → Pages**.
2. In **Build and deployment**, seleziona **GitHub Actions** come source.
3. Esegui un push su `main` (o avvia **Deploy GitHub Pages** dalla scheda Actions).
4. Attendi il completamento del workflow e apri l’indirizzo Pages mostrato da GitHub.

L’app funziona anche sul percorso Pages di un repository, non solo su un dominio personalizzato.

## Test locali

I test richiedono Node.js 20 o successivo e non richiedono dipendenze aggiuntive:

```powershell
node --test tests/*.test.mjs
```

Per provare l’app in locale, avvia un server statico dalla cartella del repository:

```powershell
python -m http.server 8000
```

Apri <http://localhost:8000>. Le API crittografiche del browser sono disponibili su localhost e su GitHub Pages via HTTPS.
