import type { ConversionService } from "./service.js";

/** Everything the convert routes need, injectable for tests. */
export interface ConvertRouteDeps {
  /**
   * Absent when `CONVERT_SERVICE_URL` is unset. That is a *state*, not an
   * error: `GET convert/health` reports `configured: false`, and only
   * `POST convert` refuses — with `503 CONVERT_NOT_CONFIGURED`.
   */
  service?: ConversionService;
}