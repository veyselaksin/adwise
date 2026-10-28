/**
 * Thresholds for the morning brief. A campaign is only called out on enough
 * volume (team note 6 sets 20 subscriptions for CAC; trials use the same bar),
 * and only when it moved more than ordinary day-to-day noise.
 */
export const BRIEF_MIN_TRIALS = 20;
export const BRIEF_MIN_SUBSCRIPTIONS = 20;
/** Cost per trial yesterday against last week's: daily values swing, so the bar is wide. */
export const BRIEF_COST_PER_TRIAL_MOVE = 0.2;
/** Week-over-week CAC on final days. */
export const BRIEF_CAC_MOVE = 0.15;
/** Days of releases the brief mentions, ending yesterday. */
export const BRIEF_RELEASE_DAYS = 7;
/** Items shown; the rest are counted. */
export const BRIEF_MAX_ITEMS = 8;
