# Obědy

Přehled školních obědů z [e-Jídelníčku](https://e-jidelnicek.cz/) na tento a příští týden. U každého dítěte je vidět kredit, co je ten den k jídlu a jestli je oběd objednaný. Otevřený den jde objednat nebo zrušit rovnou odtud.

## Spuštění

Potřeba je Python 3.11 nebo novější.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp credentials.example.json credentials.json
```

Do `credentials.json` patří e-mail a heslo rodiče do e-Jídelníčku. Soubor je v `.gitignore` a do repozitáře nepatří. Místo něj jdou použít proměnné `EJIDELNICEK_EMAIL` a `EJIDELNICEK_PASSWORD`.

```bash
uvicorn app:app --host 127.0.0.1 --port 8741
```

Přehled je na [http://127.0.0.1:8741](http://127.0.0.1:8741).

## Co stránka umí

- tabulka pondělí až pátek pro tento a příští týden, sloupec pro každé dítě
- kredit na účtě
- polévka, hlavní jídlo a příloha
- stav objednávky a do kdy ji jde změnit
- objednání, změna a zrušení, které jídelna ještě pustí

Objednávka se posílá do jídelny. U této jídelny platí, že oběd jde objednat, změnit i zrušit do 16:00 poslední den, kdy se vaří, před výdejem.

## GitHub Pages

Na GitHub Pages to běžet nemůže. Pages umí jen statické soubory, nespustí Python, nevidí IP návštěvníka a nedá se na něm schovat heslo do jídelny. Kontrola IP v prohlížeči se obejde stažením stránky. Repozitář je navíc veřejný, takže by kód i případné heslo viděl kdokoliv.

Zámek je proto v téhle aplikaci. Když je nastavený přístupový kód, z internetu stránku otevře jen `185.22.236.11` a jen po zadání kódu. Z localhostu (spuštění na vlastním počítači) se IP nekontroluje. Hlavičce `X-Forwarded-For` se věří jen při `TRUST_PROXY=1`, jinak by šla adresa podvrhnout.

```bash
ACCESS_UUID='váš-kód' ALLOWED_IPS=185.22.236.11 uvicorn app:app --host 0.0.0.0 --port 8741
```

Samotný kód se nikam neukládá. V `access.json` (je v `.gitignore`) může být jen jeho SHA-256 v poli `uuid_sha256`. Stejný otisk bere proměnná `ACCESS_UUID_SHA256`.
