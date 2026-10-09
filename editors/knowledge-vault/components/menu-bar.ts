/** Below this bar width the vault's tabs show their icons only, so the actions (help, New, settings) stay reachable. */
export const COMPACT_BELOW_PX = 760;
/** 0 means "not measured yet": keep the labels until the bar has a width. */
export const compactTabs = (barWidth: number): boolean => barWidth > 0 && barWidth < COMPACT_BELOW_PX;
