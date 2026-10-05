import { Catch, HttpException, Logger } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { randomUUID } from "node:crypto";

export function dependencyFailure(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  if (code === "P2021" || code === "P2022")
    return {
      status: 503,
      message:
        "The database schema is out of date. Run pnpm db:migrate against the production database and redeploy the API.",
    };
  if (["P1001", "P1002", "P1008", "P1017", "P2024"].includes(code ?? ""))
    return {
      status: 503,
      message: "The database is temporarily unavailable. Please retry shortly.",
    };
  if (
    error instanceof Error &&
    ["TimeoutError", "AbortError"].includes(error.name)
  )
    return {
      status: 504,
      message: "An external service timed out. Please retry shortly.",
    };
  if (error instanceof TypeError && error.message === "fetch failed")
    return {
      status: 502,
      message: "Could not reach an external service. Please retry shortly.",
    };
  return null;
}

@Catch()
export class ApiErrors implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrors.name);
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse();
    if (error instanceof HttpException) {
      const body = error.getResponse();
      response
        .status(error.getStatus())
        .json(typeof body === "string" ? { message: body } : body);
      return;
    }
    const requestId = randomUUID();
    const failure = dependencyFailure(error);
    const request = http.getRequest();
    // Do not log request bodies, URLs with query strings, tokens or database messages.
    this.logger.error(
      JSON.stringify({
        requestId,
        method: request.method,
        path: request.url?.split("?")[0],
        name: error instanceof Error ? error.name : "UnknownError",
        code: (error as { code?: string } | null)?.code,
      }),
    );
    response.status(failure?.status ?? 500).json({
      statusCode: failure?.status ?? 500,
      message:
        failure?.message ??
        `Unexpected server error. Check API logs using reference ${requestId}.`,
      requestId,
    });
  }
}
