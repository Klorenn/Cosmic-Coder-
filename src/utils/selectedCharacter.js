/** Saved selection wins; otherwise keep any existing value; otherwise the default. */
export function resolveSelectedCharacter(saved, fallback = 'vibecoder', existing) {
  return saved || existing || fallback;
}
