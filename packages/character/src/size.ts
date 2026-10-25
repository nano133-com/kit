// The character's size, in metres, as the model is built (the same size as the island's avatar). The model stands with its
// soles at y = 0 (they dip 0.008 m below) and its hair at 2.28; its widest part, the trunk, is 0.49 from the middle; its hands
// hang 0.6 from the middle. Measured from the model's own vertices (test/size.test.ts checks both numbers).

/** The character's height in metres: from the soles to the top of the hair. */
export const HEIGHT = 2.29;
/** The radius of the character's trunk in metres: the collider's radius. The hands hang to 0.6 m from the middle. */
export const RADIUS = 0.49;
