/** Default to the author’s public ACR app; reject invalid explicit overrides. */
export function agentApplicationId(value: string = "2938642"): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
