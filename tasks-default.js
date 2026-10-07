'use strict';

// Standardoppgaver. Belønning i spinn (1–10) etter hvor krevende oppgaven er.
// beer: 1 = skikkelig vanskelig oppgave som gir én pils til gode i stedet for spinn.
// proof: 'photo' = bilde kreves, 'text' = holder med en kort forklaring (bilde valgfritt).
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
];
