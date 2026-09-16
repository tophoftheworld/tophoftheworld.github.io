/**
 * Last-touch actor for purchasing overlays / archived weeks.
 * Uses admin-auth globals when Purchasing runs inside the admin shell.
 */

export function currentActor() {
  try {
    const user =
      typeof window !== 'undefined' && typeof window.getCurrentUser === 'function'
        ? window.getCurrentUser()
        : null;
    const data =
      typeof window !== 'undefined' && typeof window.getCurrentUserData === 'function'
        ? window.getCurrentUserData()
        : null;
    const uid = user?.uid || data?.uid || null;
    const name =
      data?.name ||
      data?.displayName ||
      user?.displayName ||
      data?.email ||
      user?.email ||
      null;
    if (!uid && !name) return null;
    return { uid: uid || null, name: String(name || 'Unknown') };
  } catch (_) {
    return null;
  }
}

/** Compact stamp for docs / line entries. */
export function actorStamp(actor = currentActor()) {
  if (!actor) return null;
  return {
    uid: actor.uid || null,
    name: actor.name || 'Unknown',
  };
}
