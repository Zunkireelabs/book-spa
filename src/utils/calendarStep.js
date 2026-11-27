// ZNLY-407: the calendar's one time step. Move-drag, click-to-book, hover label, block resize, the extend-drag and the +5 / -5 buttons all use it.
export const CAL_STEP_MIN = 5;

/** Length in minutes for a raw `wanted` length: whole 5-minute steps, never shorter than the service's own length. */
export const snapLength = (wanted, baseMinutes, step = CAL_STEP_MIN) => Math.max(baseMinutes, Math.round(wanted / step) * step);

/** "until 3:20pm · 50 min (+20)" — `endLabel` is the already-formatted end clock. */
export const lengthLabel = (endLabel, lengthMin, baseMinutes) => `until ${endLabel} · ${lengthMin} min${lengthMin > baseMinutes ? ` (+${lengthMin - baseMinutes})` : ''}`;
