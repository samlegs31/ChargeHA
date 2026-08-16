export const FRONIUS_CLOUD_SECRET_MASK = "********";

/**
 * The settings API never sends a stored secret back to the browser: it
 * exposes the fixed mask instead. Reuse the encrypted server-side secret
 * when Settings sends that mask, while still accepting a real password from
 * the first-run setup wizard before it has been persisted.
 */
export async function resolveFroniusCloudTestPassword(
  providedPassword: string,
  getStoredPassword: () => Promise<string | null>,
): Promise<string> {
  if (providedPassword && providedPassword !== FRONIUS_CLOUD_SECRET_MASK) {
    return providedPassword;
  }

  const storedPassword = await getStoredPassword();
  if (!storedPassword) {
    throw new Error("Solar.web password is not configured");
  }

  return storedPassword;
}
