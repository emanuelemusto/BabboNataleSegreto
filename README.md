# Babbo Natale segreto

Web app statica in italiano, pubblicabile su GitHub Pages. Non richiede server, database, servizi esterni o credenziali.

## Limite importante: un solo browser

GitHub Pages serve solo file statici e non sincronizza le iscrizioni fra dispositivi. Per questo la versione solo Pages salva il gruppo nell'archiviazione locale del browser: **tutti devono aprire il link d'invito sullo stesso dispositivo, nello stesso browser e profilo** usati per creare il gruppo. Il link non trasferisce il gruppo a un altro telefono o browser; cancellare i dati del sito può cancellare il gruppo.

L'organizzatore crea il gruppo, condivide il link d'invito e conserva per sé il link organizzatore. I partecipanti si iscrivono con lo stesso browser; il sorteggio si avvia con almeno due iscritti. A ogni persona viene mostrato una sola volta un codice casuale da conservare. Dopo il sorteggio, nome e codice consentono di leggere il proprio abbinamento. Il reset elimina tutti gli iscritti e i risultati e riapre il gruppo.

Le chiavi private dei partecipanti sono cifrate con il rispettivo codice personale; gli abbinamenti sono a loro volta cifrati con le chiavi pubbliche. L'app non presenta i risultati nel pannello organizzatore. **Essendo un'app puramente locale, non offre una garanzia di segretezza contro chi controlla il dispositivo/browser o ne ispeziona o modifica i dati**. Per partecipanti su dispositivi separati e privacy robusta serve un backend, ad esempio Supabase.

## Pubblicazione su GitHub Pages

Il workflow in `.github/workflows/deploy-pages.yml` pubblica automaticamente i file statici su ogni push al branch `main`.

1. Nel repository GitHub apri **Settings → Pages**.
2. In **Build and deployment**, seleziona **GitHub Actions** come source.
3. Esegui un push su `main` (o avvia **Deploy GitHub Pages** dalla scheda Actions).
4. Attendi il completamento del workflow e apri l'indirizzo Pages mostrato da GitHub.

L'app non usa servizi esterni e funziona anche sul percorso Pages di un repository, non solo su un dominio personalizzato.

## Test locali

I test richiedono Node.js 20 o successivo e non richiedono dipendenze aggiuntive:

```powershell
node --test tests/*.test.mjs
```

Per provare l'app in locale, avvia un server statico dalla cartella del repository, ad esempio:

```powershell
python -m http.server 8000
```

Apri <http://localhost:8000>. Usa il protocollo HTTP: le API crittografiche del browser sono disponibili su localhost e su GitHub Pages via HTTPS.
