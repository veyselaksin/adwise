/** Rounds USD to whole cents, so sums of floats print as the warehouse would. */
export const roundCents = (n: number) => Math.round(n * 100) / 100;
