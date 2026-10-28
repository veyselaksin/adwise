import Type from "typebox";
import { TOKEN_TTL_SECONDS } from "../constants/auth.constant.js";

export const LoginBody = Type.Object({
  username: Type.String({ minLength: 1, maxLength: 256, examples: ["marketing"] }),
  password: Type.String({ minLength: 1, maxLength: 256, examples: ["••••••••"] }),
});

export const Session = Type.Object({
  token: Type.String({ description: "JWT to send as `Authorization: Bearer <token>`", examples: ["eyJhbGciOi…"] }),
  expiresIn: Type.Integer({ description: "Seconds until the token expires", examples: [TOKEN_TTL_SECONDS] }),
  user: Type.String({ examples: ["marketing"] }),
});
