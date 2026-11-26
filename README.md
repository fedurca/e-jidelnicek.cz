# Obědy

Přehled školních obědů z [e-Jídelníčku](https://e-jidelnicek.cz/) na tento a příští týden. U každého dítěte je vidět kredit, jídelníček a jestli je oběd objednaný. Otevřený den jde objednat nebo zrušit.

Běží to na Cloudflare Pages. Prohlížeč mluví jen s funkcí na Pages, funkce mluví s jídelnou. Heslo do jídelny v prohlížeči není.

## Nasazení

V účtu Cloudflare založte Pages projekt z tohoto repozitáře. Sestavení nechte prázdné, výstup je složka `public`. Funkce jsou ve složce `functions`.

V nastavení projektu přidejte tajné proměnné (ne do gitu):

- `EJIDELNICEK_EMAIL` e-mail rodiče do e-Jídelníčku
- `EJIDELNICEK_PASSWORD` heslo do e-Jídelníčku
- `ACCESS_UUID` přístupový kód do téhle stránky
- `ALLOWED_IPS` `185.22.236.11`

Z jiné IP Cloudflare stránku neotevře. Podvržená hlavička `X-Forwarded-For` se nebere, platí jen `CF-Connecting-IP`, kterou nastavuje Cloudflare. Bez `ACCESS_UUID` se veřejná adresa nespustí.

Místní náhled:

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

`.dev.vars` je v `.gitignore`. Na localhostu se IP nekontroluje, kód se ptá, jakmile je `ACCESS_UUID` vyplněný.

## Python

Ve složce zůstává i původní Python server (`uvicorn app:app`). Pages ho nespouští. Je to stejný přehled pro běh bez Cloudflare.
