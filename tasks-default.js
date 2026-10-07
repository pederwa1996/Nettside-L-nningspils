'use strict';

// Standardoppgaver. Belønning i spinn (1–10) etter hvor krevende oppgaven er.
// beer: 1 = skikkelig vanskelig oppgave som gir én pils til gode i stedet for spinn.
// proof: 'photo' = bilde kreves, 'text' = holder med en kort forklaring (bilde valgfritt).
// cat: 'first' (⚡ førstemann til mølla, standard), 'duo' (👯 med én kollega), 'mingle' (🤝 alle kan
// gjøre den én gang), 'gang' (🎉 hele gjengen, minst `min` personer). Pils bare på 'first'.
// Oppgaver som er fjernet fordi de ikke kan bekreftes ut fra et bilde.
// Slettes automatisk fra lagrede data ved oppstart.
module.exports.RETIRED = [
  'Byttehandel',
  'Bursdagsbarnet',
  'Navnebror eller navnesøster',
  'Hurra for kollegaen',
  'Slå en fremmed i et spill',
  'Tale for bordet',
  'Bli kjent med tre fremmede',
  'Skål på et annet språk',
];

module.exports.TASKS = [
  { title: 'Selfie med en fremmed', desc: 'Ta en selfie med noen du ikke kjenner. Spør pent først!', reward: 3, proof: 'photo' },
  { title: 'Bartenderens favoritt', desc: 'Spør bartenderen hvilken øl hen anbefaler, og ta bilde av deg med den.', reward: 2, proof: 'photo' },
  { title: 'High five med bartenderen', desc: 'Gi bartenderen et oppriktig kompliment og få en high five. Kollegaen din tar bildet.', reward: 2, proof: 'photo' },
  { title: 'Autograf på serviett', desc: 'Få en fremmed til å skrive autografen sin på en serviett. Bilde av servietten.', reward: 3, proof: 'photo' },
  { title: 'Gruppebilde med fremmede', desc: 'Få med minst fem fremmede på ett gruppebilde.', reward: 6, proof: 'photo' },

  // Flere vanlige oppgaver
  { title: 'Ølbrikke-tårn', desc: 'Bygg et tårn av minst 10 ølbrikker som står av seg selv. Bilde av tårnet.', reward: 3, proof: 'photo' },
  { title: 'Servietkrone', desc: 'Lag en krone av servietter, sett den på hodet og ta en kongelig selfie.', reward: 1, proof: 'photo' },
  { title: 'Lån en hatt', desc: 'Lån en hatt eller caps av en fremmed og ta en selfie med den på (sammen med eieren).', reward: 3, proof: 'photo' },
  { title: 'Samme farge', desc: 'Finn en fremmed som har på seg samme farge på overdelen som deg, og ta bilde sammen.', reward: 2, proof: 'photo' },
  { title: 'Dansegulvet', desc: 'Få en fremmed til å danse med deg. Kollegaen din tar bildet mens dere danser.', reward: 4, proof: 'photo' },
  { title: 'Menneskepyramide', desc: 'Bygg en menneskepyramide med minst seks personer (kollegaer teller). Forsiktig!', reward: 5, proof: 'photo' },
  { title: 'Matkunst', desc: 'Lag et kunstverk av tacos, nachos eller servietter på bordet. Bilde av kunstverket.', reward: 2, proof: 'photo' },
  { title: 'Fem land', desc: 'Ta et bilde med folk fra fem forskjellige land. Skriv hvilke land i teksten.', reward: 6, proof: 'photo' },

  // 🍺 Skikkelig vanskelige: gir 1 pils til gode i stedet for spinn
  { title: 'Bartender for et øyeblikk', desc: 'Få lov av bartenderen til å stå bak baren et øyeblikk, og ta bilde der. Bare med tillatelse!', beer: 1, proof: 'photo' },
  { title: 'Tjue på ett bilde', desc: 'Gruppebilde med minst 20 personer, og minst 10 av dem må være fremmede.', beer: 1, proof: 'photo' },
  { title: 'Navnet ditt på tavla', desc: 'Få baren til å skrive navnet ditt på tavla eller menyen. Bilde som bevis.', beer: 1, proof: 'photo' },
  { title: 'Ølbrikke-tårn XXL', desc: 'Bygg et tårn av minst 30 ølbrikker som står av seg selv i minst fem sekunder. Bilde av tårnet.', beer: 1, proof: 'photo' },
  { title: 'Allsang', desc: 'Få minst ti personer i baren til å synge med på samme sang samtidig. Spillmesteren må være vitne, så hent hen først!', beer: 1, proof: 'text' },

  // 👯 Duo: gjøres sammen med én kollega, begge får belønningen
  { cat: 'duo', title: 'Speilbildet', desc: 'Stå helt likt som kollegaen din: samme positur, samme ansiktsuttrykk. Få noen til å ta bildet.', reward: 2, proof: 'photo' },
  { cat: 'duo', title: 'Tegn hverandre', desc: 'Tegn hverandre på hver deres serviett på 60 sekunder, uten å se ned på servietten. Bilde av dere med tegningene foran ansiktet.', reward: 3, proof: 'photo' },
  { cat: 'duo', title: 'Klesbytte', desc: 'Bytt et klesplagg (jakke, genser, skjerf eller caps) med kollegaen din resten av kvelden. Bilde av dere i hverandres klær.', reward: 3, proof: 'photo' },
  { cat: 'duo', title: 'Armbryting', desc: 'Ta en runde armbryting mot kollegaen din. Bilde midt i kampen, og skriv hvem som vant.', reward: 2, proof: 'photo' },
  { cat: 'duo', title: 'Skål i armkrok', desc: 'Skål og ta en slurk i armkrok med kollegaen din. Bilde som bevis.', reward: 1, proof: 'photo' },
  { cat: 'duo', title: 'Dobbeldate med fremmede', desc: 'Finn to fremmede som står sammen, og ta et bilde der alle fire gjør samme positur.', reward: 4, proof: 'photo' },

  // 🤝 Mingle: alle kan gjøre den én gang hver. Legg bort mobilen og snakk med folk!
  { cat: 'mingle', title: 'Mobilfri', desc: 'Gi mobilen din til spillmesteren i 15 minutter og snakk med folk imens. Spillmesteren er vitne og godkjenner.', reward: 3, proof: 'text' },
  { cat: 'mingle', title: 'Ny bordvenn', desc: 'Sett deg ved siden av en kollega du sjelden snakker med på jobb, og finn ut tre ting dere har til felles. Selfie, og skriv de tre tingene.', reward: 2, proof: 'photo' },
  { cat: 'mingle', title: 'Hemmelig talent', desc: 'Finn ut et hemmelig talent eller en morsom fun fact om en kollega. Skriv hvem og hva.', reward: 2, proof: 'text' },
  { cat: 'mingle', title: 'Komplimentrunden', desc: 'Gi tre forskjellige kollegaer et ærlig kompliment. Skriv hvem du ga det til.', reward: 2, proof: 'text' },
  { cat: 'mingle', title: 'Skål med fem', desc: 'Skål med fem forskjellige personer (minst én fremmed). Selfie med den siste, og skriv hvem du skålte med.', reward: 2, proof: 'photo' },
  { cat: 'mingle', title: 'Smak noe nytt', desc: 'Bestill noe fra menyen du aldri har smakt før. Bilde av deg mens du smaker.', reward: 1, proof: 'photo' },

  // 🎉 Hele gjengen: minst `min` personer, alle som er med får belønningen
  { cat: 'gang', min: 5, title: 'Røa Elektriske-posen', desc: 'Lag et gruppebilde der alle later som de kobler et støpsel i hverandre. Jo mer dramatisk, jo bedre.', reward: 2, proof: 'photo' },
  { cat: 'gang', min: 4, title: 'Gjenskap et kjent bilde', desc: 'Gjenskap et kjent bilde eller maleri (Nattverden, Abbey Road, Titanic …). Skriv hvilket.', reward: 3, proof: 'photo' },
  { cat: 'gang', min: 6, title: 'Skål-kjeden', desc: 'Minst seks personer i en lang kjede med armkrok, alle skåler samtidig. Bilde av kjeden.', reward: 3, proof: 'photo' },
  { cat: 'gang', min: 4, title: 'Stein, saks, papir-turnering', desc: 'Hold en ekte turnering med utslagsrunder ved bordet. Bilde av finalen, og skriv hvem som vant.', reward: 2, proof: 'photo' },
  { cat: 'gang', min: 4, title: 'Mini-quiz', desc: 'Én lager fem spørsmål om jobben eller kollegaene, resten svarer. Skriv spørsmålene og hvem som vant.', reward: 3, proof: 'text' },
];
