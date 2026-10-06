# 🍺 Lønningspils

Nettside for lønningspils med lodd, loddtrekning og lykkehjul.

## Slik fungerer det

- **Lodd:** Deltakere åpner linken, tar et profilbilde med mobilen og skriver navnet sitt. De får da 5 tilfeldige lodd av totalt 100.
- **Én per person:** Samme navn kan ikke brukes to ganger, og hver enhet (cookie) og IP-adresse kan bare registrere én person.
- **Lykkehjul:** Hver deltaker har 3 spinn. Hvert spinn har 15 % sjanse for øl. Resultatet avgjøres på serveren, så det kan ikke jukses fra nettleseren.
- **Flappy Sjef:** På `/spill.html` kan man spille Flappy Bird med sjefens ansikt for å tjene flere spinn. 50 poeng gir 1 nytt spinn, 100 gir 2, 200 gir 3, 400 gir 4 osv. Hver belønning gis én gang per person. Det finnes en toppliste med beste poengsum per person. Serveren avviser poengsummer som er umulige å nå på tiden spillet varte. Sjefens ansikt ligger i `public/boss.png`.
- **Duell:** På `/duell.html` kan man utfordre en annen deltaker i stein, saks, papir og satse spinn. Utfordreren velger motstander, innsats og sitt hemmelige trekk. Innsatsen holdes av til motstanderen svarer. Motstanderen kan godta (må ha nok spinn) eller avslå. Vinneren tar hele potten. Ved uavgjort eller avslag får utfordreren innsatsen tilbake. Spinn bytter bare eier, så det blir ikke flere spinn totalt.
- **Mogg-off:** På `/mogg.html` utfordrer man en kollega. Begge tar en selfie med sitt hardeste «chad-ansikt», og ansiktsanalyse (MediaPipe Face Landmarker, kjører i nettleseren) gir en score fra 0.00 til 10.00. Høyest score vinner 1 spinn fra den andre. Scoren måler kun ting man selv styrer: jegerøyne (myse), senkede bryn, lukket/spent kjeve, null smil og rett blikk i kamera. Den vurderer ikke utseende. En bratt kurve gjør at 10.00 nesten er umulig. Beste score per person havner på «Chad-pallen» med bildet. Utfordrerens score holdes hemmelig til motstanderen har svart. Admin kan fjerne folk fra pallen. Biblioteket og modellen ligger i `public/vendor/mediapipe`, så siden ikke er avhengig av en ekstern CDN.
- **Profilbilde:** Påkrevd ved registrering. På mobil åpnes frontkameraet direkte. Bildet skaleres ned i nettleseren før opplasting. Man kan bytte bilde ved å trykke på det på forsiden.
- **Chat:** På `/chat.html` kan alle prate live. Meldinger kommer fram med en gang via Server-Sent Events. De siste 300 meldingene lagres.
- **Story:** Øverst på forsiden og i chatten. Trykk «Din story» for å dele et bilde med valgfri tekst. Bildene slettes automatisk etter 24 timer. Man kan slette sine egne bilder.
- **Moderering:** Admin kan slette story-bilder og chatmeldinger, eller tømme hele chatten.
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
| `GAME_FIRST_MILESTONE` | `50` | Poeng for første ekstra spinn i Flappy Sjef (dobles for hver neste) |
| `DRAW_FROM` | `all` | `all` = trekk blant alle 100 lodd, `assigned` = kun blant utdelte lodd |
| `ONE_PER_IP` | `true` | Én registrering per IP-adresse |
| `TRUST_PROXY` | `false` | Sett til `true` bak en proxy (Render, Railway, Fly osv.) så riktig IP brukes |
| `DATA_FILE` | `./data.json` | Hvor data lagres |
| `MEDIA_DIR` | `./media` | Hvor bilder (profilbilder og story) lagres |

### Merk om IP-sperren

Hvis alle sitter på samme wifi (f.eks. på puben), har de samme offentlige IP-adresse, og bare én person vil da få registrert seg. Ber du folk bruke mobildata, fungerer det. Ellers kan du sette `ONE_PER_IP=false`. Da gjelder fortsatt sperren per navn og per nettleser.

### Merk om loddtrekningen

Med 100 lodd og 5 per person er det plass til 20 deltakere. Kommer det færre, kan vinnerlodd havne på lodd som ingen har fått (de vises som «Ikke utdelt»). Vil du at alle 10 ølene skal gå til noen, setter du `DRAW_FROM=assigned`.

## Hosting

Appen er én Node-prosess som lagrer i en JSON-fil. Den kan kjøres på for eksempel Render, Railway eller Fly.io (husk `TRUST_PROXY=true` og en persistent disk for `DATA_FILE`), eller på din egen maskin med en tunnel som `ngrok`.
