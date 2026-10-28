import Type from "typebox";
import { AGENT_MAX_ANSWER_CHARS, AGENT_MAX_MESSAGES, AGENT_MODEL_IDS } from "../constants/agent.constant.js";
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
    model: Type.Optional(
      literals(AGENT_MODEL_IDS, {
        description: "Which model answers (see GET /agent/models). Default: the server's AGENT_MODEL.",
        examples: [AGENT_MODEL_IDS[0]],
      }),
    ),
  },
  { title: "ChatRequest" },
);

export const AgentModels = Type.Object(
  {
    default: literals(AGENT_MODEL_IDS, { examples: [AGENT_MODEL_IDS[0]] }),
    models: Type.Array(
      Type.Object({
        id: literals(AGENT_MODEL_IDS, { examples: [AGENT_MODEL_IDS[0]] }),
        label: Type.String({ examples: ["DeepSeek V4.1 Flash"] }),
        description: Type.String({ examples: ["Fast and inexpensive. The default."] }),
      }),
    ),
  },
  { title: "AgentModels" },
);
