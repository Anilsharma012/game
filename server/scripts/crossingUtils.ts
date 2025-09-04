export function getCrossingCombinations(input: string, isJodaCut = false): string[] {
  // unique digits only (e.g. "2234" -> ["2","3","4"])
  const digits = [...new Set(String(input).replace(/\D/g, ""))];

  const combos: string[] = [];
  for (const a of digits) {
    for (const b of digits) {
      if (isJodaCut && a === b) continue; // skip 11/22/33 if jodaCut
      combos.push(a + b);                  // keep order: 22,23,24,32,33,34,...
    }
  }
  return combos;
}
