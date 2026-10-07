# 🍺 Lønningspils

Nettside for lønningspils med lodd, loddtrekning og lykkehjul.

## Slik fungerer det

- **Lodd:** Deltakere åpner linken, tar et profilbilde med mobilen og skriver navnet sitt. De får da 5 tilfeldige lodd av totalt 100.
- **Én per person:** Samme navn kan ikke brukes to ganger, og hver enhet (cookie) og IP-adresse kan bare registrere én person.
- **Innlogging kreves:** Før man har registrert seg (eller logget inn med kode) ser man bare registreringen på forsiden. Menyen og storyen er skjult, og alle andre sider (kasino, chat, oppgaver, profil osv.) sender en tilbake til forsiden. Bare `/admin.html` og `/admin-spinn.html` er åpne, fordi de har eget passord.
- **Alltid åpent for nye:** Man kan registrere seg også etter loddtrekningen, og når alle loddene er delt ut. Da får man bare ingen lodd, men spinn, flus og alt annet som vanlig.
- **Flere enheter:** Er man registrert på mobilen, kan man bruke samme profil på PC-en: trykk «💻 Bruk på en annen enhet» på forsiden, og skriv inn koden (eller åpne lenken) på den andre enheten under «Logg inn med kode». Koden virker én gang og går ut etter 10 minutter.
- **Lykkehjul:** Hver deltaker har 3 spinn. Hvert spinn har 15 % sjanse for øl. Resultatet avgjøres på serveren, så det kan ikke jukses fra nettleseren.
- **Flappy Sjef:** På `/spill.html` kan man spille Flappy Bird med sjefens ansikt for å tjene flere spinn. 50 poeng gir 1 nytt spinn, 100 gir 2, 200 gir 3, 400 gir 4 osv. Hver belønning gis én gang per person. Det finnes en toppliste med beste poengsum per person. Serveren avviser poengsummer som er umulige å nå på tiden spillet varte. Sjefens ansikt ligger i `public/boss.png`.
- **Duell:** På `/duell.html` kan man utfordre en annen deltaker i stein, saks, papir og satse spinn. Utfordreren velger motstander, innsats og sitt hemmelige trekk. Innsatsen holdes av til motstanderen svarer. Motstanderen kan godta (må ha nok spinn) eller avslå. Vinneren tar hele potten. Ved uavgjort eller avslag får utfordreren innsatsen tilbake. Spinn bytter bare eier, så det blir ikke flere spinn totalt.
- **Mogg-off:** På `/mogg.html` utfordrer man en kollega. Begge tar en selfie med sitt hardeste «chad-ansikt», og ansiktsanalyse (MediaPipe Face Landmarker, kjører i nettleseren) gir en score fra 0.00 til 10.00. Høyest score vinner 1 spinn fra den andre. Scoren måler kun ting man selv styrer: jegerøyne (myse), senkede bryn, lukket/spent kjeve, null smil og rett blikk i kamera. Den vurderer ikke utseende. En bratt kurve gjør at 10.00 nesten er umulig. Beste score per person havner på «Chad-pallen» med bildet. Utfordrerens score holdes hemmelig til motstanderen har svart. Admin kan fjerne folk fra pallen. Biblioteket og modellen ligger i `public/vendor/mediapipe`, så siden ikke er avhengig av en ekstern CDN.
- **Kasino:** På `/kasino.html`. Alle har **flus** (penger), og starter med `START_FLUS` (100).
  - **Automat:** koster 1 spinn (eller `SPIN_PRICE` flus) per trekk og gir flus (10–500), eller 🍺🍺🍺 (2 % sjanse) som gir én pils til gode. Utfallet avgjøres på serveren.
  - **Roulette** (europeisk, én null; bare rød, svart, partall og oddetall, som betaler dobbelt tilbake: sats 25, få 50. Vinnersjanse 18/37 = 48,6 %, som i et ekte kasino) og **blackjack** (dealer trekker til 17, 3:2, doble, ingen splitting) spilles med flus, 10–`CASINO_MAX_BET` (200) per runde.
- **Poker:** Fane i kasinoet. Ett Texas Hold'em-bord med 9 plasser. Man setter seg med flus (innkjøp `POKER_MIN_BUYIN`–`POKER_MAX_BUYIN`, standard 100–1000) og får sjetongene tilbake som flus når man reiser seg. Blinds `POKER_SMALL_BLIND`/`POKER_BIG_BLIND` (5/10). Kast, sjekk, syn, høyn og all in, med sidepotter. 30 sekunder per handling, ellers sjekkes/kastes det automatisk, og to tidsavbrudd på rad gjør at man reiser seg. Er bordet fullt, kan man se på. Alle kort holdes på serveren, så ingen kan se andres kort. Huset tar ingenting. En hånd som er i gang når serveren starter på nytt, avbrytes og alle får innsatsen tilbake.
- **Lykkehjulet** kan også spinnes for `SPIN_PRICE` flus (standard 50) når man er tom for spinn. Prisen er satt over det et spinn er verdt i snitt, så flus aldri blir en pengemaskin.
- **Baren:** Egen fane i kasinoet (`/kasino.html#baren`, gamle `/baren.html` sender dit). Man kan bestille pils man har til gode (lykkehjul, vinnerlodd, automat) eller kjøpe pils for flus (`PILS_PRICE`, standard 250). Bestillingen går til spillmesteren (admin), som får et 🍺-varsel. Man kan avbryte en bestilling som ikke er levert, og får da flusen tilbake. Maks 5 pils per bestilling og 3 bestillinger som venter. Øverst i baren er det en ekte barscene: hyller med flasker, neonskilt og tappekraner. Spillmesteren står bak disken når hen er i baren, og alle som er i baren akkurat nå sitter på hver sin krakk med profilbilde (live). Når man bestiller, sklir en pils bortover disken.
- **Bestillingsboble (admin):** Når admin er logget inn, vises en 🍺-boble nederst til høyre på alle sider i den fanen. Den viser antall pils som venter, piper og vibrerer når nye bestillinger kommer, og admin markerer dem som levert eller avbryter (flus betales tilbake).
- **Oppgaveboble (admin):** Rett over 🍺-boblen ligger en 🎯-boble for oppgaver som venter på godkjenning. Den viser antallet, piper og vibrerer når noen leverer, og i panelet ser admin bevisbildet og teksten og kan godkjenne (spinnene gis med en gang) eller avvise med en begrunnelse, uten å gå til admin-siden.
- **Varsler (🔔):** Alle brukere har en 🔔-boble nede til venstre. Den viser antall uleste varsler, og nye varsler spretter opp som en melding øverst (live). Man får varsel når spillmesteren godkjenner eller avviser en oppgave, gir eller tar spinn, leverer eller avbryter en pilsbestilling, når noen liker eller kommenterer bildene/innleggene dine (eller kommenterer der du har kommentert), og når noen utfordrer deg eller svarer på en duell eller mogg-off. Trykker man på et varsel, kommer man rett dit, f.eks. åpnes bildet med kommentarene på profilen.
- **Oppgaver:** På `/oppgaver.html` kan man løse oppgaver i baren (f.eks. «Selfie med en fremmed») mot 1–10 spinn etter hvor krevende de er. Man leverer bevis (bilde og/eller tekst), og oppgaven låses mens admin vurderer. Godkjent: personen får spinnene og oppgaven er løst for godt. Avvist: oppgaven åpnes for alle igjen, og personen ser begrunnelsen. Maks 2 innleveringer som venter per person. Bevisbildene vises bare for admin. Standardoppgavene ligger i `tasks-default.js`, og admin kan legge til og slette oppgaver.
- **Profiler:** `/profil.html?navn=...` (trykk på et navn eller bilde, eller «👤 Min profil»). Viser statistikk (pils, spinn, flus, rekorder, dueller, mogg-offs, oppgaver, kasino-resultat), bildegalleri (godkjente oppgavebilder, mogg-bilder, aktive stories) og all aktivitet. Alle kan like ❤️ og kommentere aktiviteter og bilder. Man kan slette egne kommentarer, admin kan slette alle. Oppdateres live.
- **Live gevinster i kasinoet:** Alle gevinster vises med avatar i en live-liste, og andre får et lite varsel øverst på skjermen.
- **Hvem er her:** Øverst til høyre på hver side vises profilbildene til de andre som er på samme side akkurat nå (kasinofanene teller hver for seg). Nye som kommer inn spretter inn med «Navn kom inn 👋», og trykk på bunken viser hvem det er. Flisene under «Spill» på forsiden viser hvor mange som er der. Nettleseren sender et livstegn hvert 20. sekund, og man forsvinner når man lukker siden (eller etter 45 sekunder uten livstegn).
- **Leaderboard:** På forsiden vises alle deltakere med antall øl vunnet (lykkehjul + vinnerlodd) og antall spinn de har igjen. Like mange øl gir delt plassering.
- **Profilbilde:** Påkrevd ved registrering. På mobil åpnes frontkameraet direkte. Bildet skaleres ned i nettleseren før opplasting. Man kan bytte bilde ved å trykke på det på forsiden.
- **Chat:** På `/chat.html` kan alle prate live. Meldinger kommer fram med en gang via Server-Sent Events. De siste 300 meldingene lagres.
- **Story:** Øverst på forsiden og i chatten. Trykk «Din story» for å dele et bilde med valgfri tekst. Bildene slettes automatisk etter 24 timer. Man kan slette sine egne bilder.
- **Spinn-admin:** På `/admin-spinn.html` (knapp øverst på admin-siden) kan admin gi eller ta spinn fra hver deltaker med + og −, i steg på 1, 2, 5 eller 10. Man kan ikke ta flere spinn enn personen har. Alle endringer logges på siden.
- **Spillmester (admin som egen bruker):** Registrer deg som vanlig deltaker, og logg inn på `/admin.html` med passordet fra den samme enheten. Da kobles admin til profilen din (👑 Spillmester). Etterpå er du admin automatisk på den enheten, uten passord: admin-sidene, spinn-admin og bestillingsboblen virker direkte, og forsiden får en «🔐 Admin»-knapp. Passordet virker fortsatt fra alle enheter.
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
| `POKER_SMALL_BLIND` / `POKER_BIG_BLIND` | `5` / `10` | Blinds ved pokerbordet |
| `POKER_MIN_BUYIN` / `POKER_MAX_BUYIN` | `100` / `1000` | Innkjøp ved pokerbordet (flus) |
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
