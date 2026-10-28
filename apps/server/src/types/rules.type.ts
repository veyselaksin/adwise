/** A rule the team added in the dashboard; enabled rules go into the agent's prompt. */
export type Rule = { id: string; text: string; enabled: boolean; createdAt: string; updatedAt: string };

export type RuleChanges = { text?: string; enabled?: boolean };
