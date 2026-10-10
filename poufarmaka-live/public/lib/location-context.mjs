// Used only for help text, never to grant or gate access.
export function locationBrowser(ua = '') {
  if (/EdgiOS|EdgA?\//.test(ua)) return 'Microsoft Edge';
  if (/CriOS|Chrome\//.test(ua)) return 'Google Chrome';
  if (/FxiOS|Firefox\//.test(ua)) return 'Firefox';
  if (/Version\/.*Safari\//.test(ua)) return 'Safari';
  return 'Ενσωματωμένος ή άλλος browser';
}
export function isStandalone({standalone=false,displayMode=false}={}) { return standalone===true || displayMode===true; }
export function locationReport({error, browser, host, secure, embedded, policyAllowed, elapsedMs, standalone=false}) {
  // Exclude coordinates, IP, full UA and the page's query string.
  return ['Farmakeia · έλεγχος PF-LOC-4',`Browser: ${browser}`,`Ιστότοπος: ${host}`,
    `Άνοιγμα: ${standalone ? 'Web app αρχικής οθόνης' : 'Browser'}`,
    `Κωδικός: ${String(error?.code || 'unknown')}`,
    `Μήνυμα browser: ${String(error?.message || '(δεν δόθηκε)').slice(0,500)}`,
    `HTTPS: ${secure ? 'ναι' : 'όχι'}`,`Μέσα σε πλαίσιο: ${embedded ? 'ναι' : 'όχι'}`,
    `Πολιτική σελίδας: ${policyAllowed === null ? 'δεν αναφέρεται' : policyAllowed ? 'επιτρέπεται' : 'αποκλείεται'}`,
    `Χρόνος απόκρισης: ${Math.round(elapsedMs)} ms`].join('\n');
}
