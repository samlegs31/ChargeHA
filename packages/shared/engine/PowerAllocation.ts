/** Allocate a shared watt budget without assuming identical charging circuits. */
export interface PowerRecipient {
  id: string;
  wattsPerAmp: number;
  maxAmps: number;
}

export function allocatePower(
  recipients: PowerRecipient[],
  budgetW: number,
  equal: boolean,
): Map<string, number> {
  const budget = Number.isFinite(budgetW) ? Math.max(0, budgetW) : 0;
  const valid = recipients.filter((r) =>
    Number.isFinite(r.wattsPerAmp) && r.wattsPerAmp > 0 &&
    Number.isFinite(r.maxAmps) && r.maxAmps >= 0
  );
  if (!equal) {
    return valid.reduce((acc, r) => {
      const amps = Math.min(
        Math.floor(r.maxAmps),
        Math.floor(acc.left / r.wattsPerAmp),
      );
      return {
        left: acc.left - amps * r.wattsPerAmp,
        amps: new Map(acc.amps).set(r.id, amps),
      };
    }, { left: budget, amps: new Map<string, number>() }).amps;
  }
  const initial = new Map(valid.map((r) => [
    r.id,
    Math.min(
      Math.floor(r.maxAmps),
      Math.floor(budget / valid.length / r.wattsPerAmp),
    ),
  ]));
  return fillRemainder(valid, budget, initial);
}

function fillRemainder(
  recipients: PowerRecipient[],
  budget: number,
  initial: Map<string, number>,
): Map<string, number> {
  // One pass per possible amp bounds the work and avoids recursive stack growth.
  const increments = recipients.reduce(
    (sum, r) => sum + Math.floor(r.maxAmps),
    0,
  );
  return Array.from({ length: increments }).reduce<Map<string, number>>(
    (amps) => {
      const used = recipients.reduce(
        (sum, r) => sum + (amps.get(r.id) ?? 0) * r.wattsPerAmp,
        0,
      );
      const next =
        recipients.filter((r) =>
          (amps.get(r.id) ?? 0) < r.maxAmps && r.wattsPerAmp <= budget - used
        ).sort((a, b) =>
          (amps.get(a.id) ?? 0) * a.wattsPerAmp -
          (amps.get(b.id) ?? 0) * b.wattsPerAmp
        )[0];
      return next
        ? new Map(amps).set(next.id, (amps.get(next.id) ?? 0) + 1)
        : amps;
    },
    initial,
  );
}
