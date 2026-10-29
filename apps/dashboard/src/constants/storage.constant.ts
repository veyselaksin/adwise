export const STORAGE_KEYS = {
  agentTurns: "adwise.agent.turns",
  agentModel: "adwise.agent.model",
  briefCollapsed: "adwise.brief.collapsed",
} as const;

/** Tells other brief frames on the page that the collapsed state changed. */
export const BRIEF_COLLAPSED_EVENT = "adwise:brief-collapsed";
