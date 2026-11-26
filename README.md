# Babbo Natale segreto

Una piccola web app in italiano per organizzare un sorteggio: ogni persona riceve il proprio abbinamento nel browser, mentre l'organizzatore può avviare o azzerare il gruppo senza vedere i risultati.

## Avvio in locale

Richiede Python 3.10 o successivo.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Apri <http://127.0.0.1:5000>. Crea un gruppo e conserva il link organizzatore: è l'unico modo per avviare o azzerare il sorteggio. Condividi il link di invito con i partecipanti. Ognuno si iscrive dal proprio browser e, dopo l'avvio, vede soltanto il proprio destinatario nello stesso browser.

Il gruppo deve avere almeno due iscritti. I nomi devono essere diversi. L'organizzatore vede il numero degli iscritti, ma non i nomi né gli abbinamenti. **Azzera gruppo** elimina iscrizioni e abbinamenti, quindi riapre il gruppo mantenendo gli stessi link.

## Configurazione

Per spostare il database SQLite, imposta la variabile `DATABASE_PATH` prima di avviare l'app. Il percorso predefinito è `data/secret_santa.sqlite3`. In produzione usa un server WSGI, ad esempio Waitress:

```powershell
pip install waitress
waitress-serve --host 0.0.0.0 --port 8080 app:app
```

Il disco del servizio deve essere persistente per conservare gruppi e iscrizioni tra riavvii. Tratta i link organizzatore come password: chiunque li possieda può avviare o azzerare il gruppo.

## Test

```powershell
python -m unittest discover -s tests -v
```
