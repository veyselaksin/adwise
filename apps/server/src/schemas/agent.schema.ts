import Type from "typebox";
import { AGENT_MAX_ANSWER_CHARS, AGENT_MAX_MESSAGES } from "../constants/agent.constant.js";
import { literals } from "./common.schema.js";

export const ChatMessage = Type.Object(
  {
    role: literals(["user", "assistant"], { examples: ["user"] }),
    text: Type.String({ maxLength: AGENT_MAX_ANSWER_CHARS, examples: ["Which US ad set had the lowest CAC last week?"] }),
  },
  { title: "ChatMessage" },
);

export const ChatBody = Type.Object(
  {
    messages: Type.Array(ChatMessage, {
      minItems: 1,
      maxItems: AGENT_MAX_MESSAGES,
      description:
        "The whole conversation, oldest first, ending with the user's new question. The server keeps no chat state.",
    }),
  },
  { title: "ChatRequest" },
);
