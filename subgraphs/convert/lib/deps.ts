import type { ConversionService } from "./service.js";

/** Everything the convert routes need, injectable for tests. */
export interface ConvertRouteDeps {
  /**
   * Absent when `CONVERT_SERVICE_URL` is unset. That is a *state*, not an
   * error: `GET convert/health` reports `configured: false`, and only
   * `POST convert` refuses — with `503 CONVERT_NOT_CONFIGURED`.
   */
  service?: ConversionService;
  /** Where the service came from: the environment at setup, or the runtime setter (lib/runtime.ts). Absent when unconfigured. */
  source?: "env" | "runtime";
  /**
   * The largest upload `POST convert` takes, read from the environment at
   * setup (routes/convert.ts `maxUploadBytes`); health reports it so a client
   * checks a file against this vault's cap, not a guess. Absent: the default.
   */
  maxUploadBytes?: number;
}
