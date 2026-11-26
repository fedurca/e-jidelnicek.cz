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
