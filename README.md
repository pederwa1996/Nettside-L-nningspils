# 🍺 Lønningspils

Nettside for lønningspils med lodd, loddtrekning og lykkehjul.

## Slik fungerer det

- **Lodd:** Deltakere åpner linken, tar et profilbilde med mobilen og skriver navnet sitt. De får da 5 tilfeldige lodd av totalt 100.
- **Én per person:** Samme navn kan ikke brukes to ganger, og hver enhet (cookie) og IP-adresse kan bare registrere én person.
- **Lykkehjul:** Hver deltaker har 3 spinn. Hvert spinn har 15 % sjanse for øl. Resultatet avgjøres på serveren, så det kan ikke jukses fra nettleseren.
- **Flappy Sjef:** På `/spill.html` kan man spille Flappy Bird med sjefens ansikt for å tjene flere spinn. 50 poeng gir 1 nytt spinn, 100 gir 2, 200 gir 3, 400 gir 4 osv. Hver belønning gis én gang per person. Det finnes en toppliste med beste poengsum per person. Serveren avviser poengsummer som er umulige å nå på tiden spillet varte. Sjefens ansikt ligger i `public/boss.png`.
- **Duell:** På `/duell.html` kan man utfordre en annen deltaker i stein, saks, papir og satse spinn. Utfordreren velger motstander, innsats og sitt hemmelige trekk. Innsatsen holdes av til motstanderen svarer. Motstanderen kan godta (må ha nok spinn) eller avslå. Vinneren tar hele potten. Ved uavgjort eller avslag får utfordreren innsatsen tilbake. Spinn bytter bare eier, så det blir ikke flere spinn totalt.
- **Mogg-off:** På `/mogg.html` utfordrer man en kollega. Begge tar en selfie med sitt hardeste «chad-ansikt», og ansiktsanalyse (MediaPipe Face Landmarker, kjører i nettleseren) gir en score fra 0.00 til 10.00. Høyest score vinner 1 spinn fra den andre. Scoren måler kun ting man selv styrer: jegerøyne (myse), senkede bryn, lukket/spent kjeve, null smil og rett blikk i kamera. Den vurderer ikke utseende. En bratt kurve gjør at 10.00 nesten er umulig. Beste score per person havner på «Chad-pallen» med bildet. Utfordrerens score holdes hemmelig til motstanderen har svart. Admin kan fjerne folk fra pallen. Biblioteket og modellen ligger i `public/vendor/mediapipe`, så siden ikke er avhengig av en ekstern CDN.
- **Kasino:** På `/kasino.html`. Alle har **flus** (penger), og starter med `START_FLUS` (100).
  - **Automat:** koster 1 spinn (eller `SPIN_PRICE` flus) per trekk og gir flus (10–500), eller 🍺🍺🍺 (2 % sjanse) som gir én pils til gode. Utfallet avgjøres på serveren.
  - **Roulette** (europeisk, én null) og **blackjack** (dealer trekker til 17, 3:2, doble, ingen splitting) spilles med flus, 10–`CASINO_MAX_BET` (200) per runde.
- **Lykkehjulet** kan også spinnes for `SPIN_PRICE` flus (standard 50) når man er tom for spinn. Prisen er satt over det et spinn er verdt i snitt, så flus aldri blir en pengemaskin.
- **Baren:** Egen fane i kasinoet (`/kasino.html#baren`, gamle `/baren.html` sender dit). Man kan bestille pils man har til gode (lykkehjul, vinnerlodd, automat) eller kjøpe pils for flus (`PILS_PRICE`, standard 250). Bestillingen går til spillmesteren (admin), som får et 🍺-varsel. Man kan avbryte en bestilling som ikke er levert, og får da flusen tilbake. Maks 5 pils per bestilling og 3 bestillinger som venter.
- **Bestillingsboble (admin):** Når admin er logget inn, vises en 🍺-boble nederst til høyre på alle sider i den fanen. Den viser antall pils som venter, piper og vibrerer når nye bestillinger kommer, og admin markerer dem som levert eller avbryter (flus betales tilbake).
- **Oppgaver:** På `/oppgaver.html` kan man løse oppgaver i baren (f.eks. «Selfie med en fremmed») mot 1–10 spinn etter hvor krevende de er. Man leverer bevis (bilde og/eller tekst), og oppgaven låses mens admin vurderer. Godkjent: personen får spinnene og oppgaven er løst for godt. Avvist: oppgaven åpnes for alle igjen, og personen ser begrunnelsen. Maks 2 innleveringer som venter per person. Bevisbildene vises bare for admin. Standardoppgavene ligger i `tasks-default.js`, og admin kan legge til og slette oppgaver.
- **Leaderboard:** På forsiden vises alle deltakere med antall øl vunnet (lykkehjul + vinnerlodd) og antall spinn de har igjen. Like mange øl gir delt plassering.
- **Profilbilde:** Påkrevd ved registrering. På mobil åpnes frontkameraet direkte. Bildet skaleres ned i nettleseren før opplasting. Man kan bytte bilde ved å trykke på det på forsiden.
- **Chat:** På `/chat.html` kan alle prate live. Meldinger kommer fram med en gang via Server-Sent Events. De siste 300 meldingene lagres.
- **Story:** Øverst på forsiden og i chatten. Trykk «Din story» for å dele et bilde med valgfri tekst. Bildene slettes automatisk etter 24 timer. Man kan slette sine egne bilder.
- **Spinn-admin:** På `/admin-spinn.html` (knapp øverst på admin-siden) kan admin gi eller ta spinn fra hver deltaker med + og −, i steg på 1, 2, 5 eller 10. Man kan ikke ta flere spinn enn personen har. Alle endringer logges på siden.
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
| `START_FLUS` | `100` | Flus alle starter med |
| `CASINO_MAX_BET` | `200` | Maks innsats i flus per runde i roulette og blackjack |
| `PILS_PRICE` | `250` | Pris i flus for én pils i baren |
| `SPIN_PRICE` | `50` | Pris i flus for ett spinn på lykkehjulet eller automaten |
| `GAME_FIRST_MILESTONE` | `50` | Poeng for første ekstra spinn i Flappy Sjef (dobles for hver neste) |
| `DRAW_FROM` | `all` | `all` = trekk blant alle 100 lodd, `assigned` = kun blant utdelte lodd |
| `ONE_PER_IP` | `true` | Én registrering per IP-adresse |
| `TRUST_PROXY` | `false` | Sett til `true` bak en proxy (Render, Railway, Fly osv.) så riktig IP brukes |
| `DATA_FILE` | `./data.json` | Hvor data lagres |
| `MEDIA_DIR` | `./media` | Hvor bilder (profilbilder og story) lagres |
| `SUPABASE_URL` | – | Project URL fra Supabase. Slår på varig lagring |
| `SUPABASE_KEY` | – | Hemmelig nøkkel fra Supabase (service_role / secret). **Del aldri denne** |

### Varig lagring med Supabase (gratis)

Gratisversjonen av Render sletter disken når tjenesten sovner eller startes på nytt. Med Supabase lagres alt der i stedet:

- Data (deltakere, spinn, chat, dueller osv.) lagres som én JSON-fil i den private bøtta `lonningspils-data`.
- Bilder lastes opp til den offentlige bøtta `lonningspils-media`.
- Bøttene opprettes automatisk. Du trenger ikke kjøre noe SQL.

Oppsett:
1. Lag en gratis konto og et nytt prosjekt på supabase.com.
2. Under **Project Settings → API Keys**, kopier **Project URL** og den **hemmelige** nøkkelen (`service_role` eller `sb_secret_...`, ikke `anon`/`publishable`).
3. Legg dem inn i Render som `SUPABASE_URL` og `SUPABASE_KEY`.
4. I loggen til Render skal det stå «☁️ Supabase er klar» ved oppstart.

Når serveren starter, hentes lagrede data fra Supabase. Klarer den ikke koble til, avslutter den heller enn å starte tomt, så lagrede data ikke blir overskrevet.

### Merk om IP-sperren

Hvis alle sitter på samme wifi (f.eks. på puben), har de samme offentlige IP-adresse, og bare én person vil da få registrert seg. Ber du folk bruke mobildata, fungerer det. Ellers kan du sette `ONE_PER_IP=false`. Da gjelder fortsatt sperren per navn og per nettleser.

### Merk om loddtrekningen

Med 100 lodd og 5 per person er det plass til 20 deltakere. Kommer det færre, kan vinnerlodd havne på lodd som ingen har fått (de vises som «Ikke utdelt»). Vil du at alle 10 ølene skal gå til noen, setter du `DRAW_FROM=assigned`.

## Hosting

Appen er én Node-prosess som lagrer i en JSON-fil. Den kan kjøres på for eksempel Render, Railway eller Fly.io (husk `TRUST_PROXY=true` og en persistent disk for `DATA_FILE`), eller på din egen maskin med en tunnel som `ngrok`.
