import { TOKEN_TTL_SECONDS } from "../constants/auth.constant.js";
import { safeEqual } from "../lib/crypto.js";
import { AppError } from "../lib/response.js";
import type { Session } from "../types/auth.type.js";

type SignToken = (payload: { sub: string }, opts: { expiresIn: number }) => Promise<string>;

/** One shared team account (`APP_USER` / `APP_PASSWORD`) exchanged for a JWT. */
export class AuthService {
  constructor(
    private readonly credentials: { user: string; password: string },
    private readonly sign: SignToken,
  ) {}

  async login(username: string, password: string): Promise<Session> {
    // Evaluate both so a wrong username takes as long as a wrong password.
    const userOk = safeEqual(username, this.credentials.user);
    const passOk = safeEqual(password, this.credentials.password);
    if (!userOk || !passOk) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Wrong username or password");
    }
    const token = await this.sign({ sub: username }, { expiresIn: TOKEN_TTL_SECONDS });
    return { token, expiresIn: TOKEN_TTL_SECONDS, user: username };
  }
}
