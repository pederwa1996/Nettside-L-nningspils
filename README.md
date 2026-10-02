# 🍺 Lønningspils

Nettside for lønningspils med lodd, loddtrekning og lykkehjul.

## Slik fungerer det

- **Lodd:** Deltakere åpner linken og skriver navnet sitt. De får da 5 tilfeldige lodd av totalt 100.
- **Én per person:** Samme navn kan ikke brukes to ganger, og hver enhet (cookie) og IP-adresse kan bare registrere én person.
- **Lykkehjul:** Hver deltaker har 3 spinn. Hvert spinn har 15 % sjanse for øl. Resultatet avgjøres på serveren, så det kan ikke jukses fra nettleseren.
- **Loddtrekning:** Admin går til `/admin.html`, skriver passordet og trykker **Kjør loddtrekning**. Da blir 10 av de 100 loddene tilfeldig trukket ut som vinnerlodd, og hvert av dem er verdt én øl. Resultatet vises for alle.

## Kjøre lokalt

Krever Node.js 18 eller nyere. Ingen avhengigheter.

```bash
ADMIN_PASSWORD=hemmelig npm start
# åpne http://localhost:3000
```

## Innstillinger (miljøvariabler)

| Variabel | Standard | Beskrivelse |
|---|---|---|
| `ADMIN_PASSWORD` | `pils123` | Passord for admin. **Bytt dette!** |
| `PORT` | `3000` | Port |
| `TOTAL_TICKETS` | `100` | Antall lodd totalt |
| `TICKETS_PER_PERSON` | `5` | Lodd per deltaker |
| `WINNING_TICKETS` | `10` | Antall vinnerlodd (øl) |
| `SPINS_PER_PERSON` | `3` | Spinn per deltaker |
| `SPIN_WIN_CHANCE` | `0.15` | Sjanse for øl per spinn |
| `DRAW_FROM` | `all` | `all` = trekk blant alle 100 lodd, `assigned` = kun blant utdelte lodd |
| `ONE_PER_IP` | `true` | Én registrering per IP-adresse |
| `TRUST_PROXY` | `false` | Sett til `true` bak en proxy (Render, Railway, Fly osv.) så riktig IP brukes |
| `DATA_FILE` | `./data.json` | Hvor data lagres |

### Merk om IP-sperren

Hvis alle sitter på samme wifi (f.eks. på puben), har de samme offentlige IP-adresse, og bare én person vil da få registrert seg. Ber du folk bruke mobildata, fungerer det. Ellers kan du sette `ONE_PER_IP=false`. Da gjelder fortsatt sperren per navn og per nettleser.

### Merk om loddtrekningen

Med 100 lodd og 5 per person er det plass til 20 deltakere. Kommer det færre, kan vinnerlodd havne på lodd som ingen har fått (de vises som «Ikke utdelt»). Vil du at alle 10 ølene skal gå til noen, setter du `DRAW_FROM=assigned`.

## Hosting

Appen er én Node-prosess som lagrer i en JSON-fil. Den kan kjøres på for eksempel Render, Railway eller Fly.io (husk `TRUST_PROXY=true` og en persistent disk for `DATA_FILE`), eller på din egen maskin med en tunnel som `ngrok`.
