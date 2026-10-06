'use strict';

// Standardoppgaver. Belønning i spinn (1–10) etter hvor krevende oppgaven er.
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
];
