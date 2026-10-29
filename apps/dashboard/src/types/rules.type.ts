/** A rule the team added on the Rules page; enabled rules go to the agent with every question. */
export type Rule = { id: string; text: string; enabled: boolean; createdAt: string; updatedAt: string };

export type RuleResult = { error?: string; rule?: Rule };
