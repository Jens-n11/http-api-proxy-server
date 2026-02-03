import axios, { AxiosError, AxiosRequestConfig } from "axios";
import {
  IncomingMessage,
  ServerResponse as Res,
  IncomingHttpHeaders,
  createServer,
  Server as HttpServer,
} from "http";
import { clone } from "remeda";
import { print, printError, printLimit, printNoMatch } from "./print";
import { ResponseCacheConnector } from "./response-cache";

export type HttpApiProxyServerSettings = {
  find?: string;
  proxyBehavior?: ProxyBehavior;
  hideErrors?: boolean;
  responsesToLog?: RequestId[];
  sourceHost: string | "www.example.com";
  sourcePort: 443 | number;
  proxyPort: 80 | number;
};
type GraphQLCompatibleResponse = {
  errors?: { message: string; status?: number }[];
};
type ResponseBody = Record<string, unknown> & GraphQLCompatibleResponse;
const requestIdPrefix = "responseFor";
export type RequestId = `responseFor${string}`;
export type Request = {
  requestId: RequestId;
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: string | undefined;
};
export type ProxyResponse = {
  status: number;
  headers?: Record<string, unknown>;
  body: ResponseBody;
};
type ProxyResponses = Record<RequestId, ProxyResponse>;
type MatchPaths = { value: string; path: string };
type ProxyBehavior =
  | "SAVE_RESPONSES_FOR_NEW_QUERIES" // Default
  | "SAVE_RESPONSES_AND_DELETE_UNUSED"
  | "RELOAD_RESPONSES_WITH_ERRORS"
  | "NO_REQUEST_FORWARDING" // Just use the local response files AND return errors in case there is no fitting response file
  | "FORCE_UPDATE_ALL";
const defaultProxyBehavior = "SAVE_RESPONSES_FOR_NEW_QUERIES";

// This will be used in case no headers were found with a (saved, or overwrite) response
export const fallbackHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

// TODO move into class
export const generateResponseOverwriteCode = (
  request: Request,
  potentialPathsForChanges: MatchPaths[],
  searchValue: string,
  filePath: string
) => {
  const cacheDirPathExample = ["put", "your", "path", "here"];
  // TODO update code
  return `You can change values containing "${searchValue}" as follows:

    import ${request.requestId} from '${filePath}'

    ${potentialPathsForChanges
      .map(({ path, value }) => `${request.requestId}${path} = ${value}\n`)
      .join("    ")}

    // Use the custom values like this:
    const proxyServer = new HttpApiProxyServer({
      cacheDirPath: ${JSON.stringify(cacheDirPathExample)},
      overwrites: {${request.requestId}},
    })

    // Do not forget to run proxyServer.start() and proxyServer.stop() to use the proxy
    `;
};

// TODO move into class (all error checkers)
const isErrorStatus = (status: number) => status !== 200;
const isGraphqlError = (body: ResponseBody) => body?.errors !== undefined;
export const hasError = (resp: ProxyResponse) =>
  isGraphqlError(resp.body) || isErrorStatus(resp.status);

// TODO move into class
export const printErrors = (
  response: ProxyResponse,
  settings: HttpApiProxyServerSettings | undefined,
  filePath: string
) => {
  const stat = response.status.toString();
  if (!settings?.hideErrors && hasError(response)) {
    if (response.body.errors)
      response.body.errors.forEach(({ message }) =>
        printError(stat, message, filePath)
      );
    else printError(stat, "Server Error", filePath);
  }
};

// TODO move into class and improve Error
export const createRequestId = ({
  url,
  body,
}: {
  url: string | undefined;
  body: string | undefined;
}): RequestId => {
  if (!url) {
    throw new Error("[requestToId] Cannot handle a request with missing URL");
  }
  return (requestIdPrefix +
    Array.from(JSON.stringify({ url, body }))
      .reduce((hash, char) => 0 | (31 * hash + char.charCodeAt(0)), 0)
      .toString()
      .replace("-", "0")) as RequestId; // because '-' would cause some problems in the code
};

export const isNumberString = (str: string) =>
  !isNaN(str as unknown as number) && !isNaN(parseFloat(str));

export const findObjectPaths = (
  obj: ResponseBody,
  search: string
): MatchPaths[] => {
  const paths: MatchPaths[] = [];
  const searchHelper = (currentObj: ResponseBody, currentPath: string) => {
    for (const key in currentObj) {
      const rawValue = currentObj[key];
      const value = JSON.stringify(rawValue);
      const path = currentPath + (isNumberString(key) ? `[${key}]` : `.${key}`);
      if (typeof rawValue === "object") {
        searchHelper(rawValue as ResponseBody, path);
      } else if (value.includes(search)) {
        paths.push({ value, path });
      }
    }
  };
  searchHelper(obj, "");
  return paths;
};

// TODO move into class
export const printFindDeveloperHelp = (
  request: Request,
  response: ProxyResponse,
  filePath: string,
  find: string | undefined
) => {
  // TODO exclude if (!find)
  if (!find) return; // Do not print anything if there is no search
  const matchMax = 80;
  const responseValuePaths = findObjectPaths(response, find);
  // TODO this chould be refactored to return strings
  if (responseValuePaths.length === 0) return printNoMatch(find, filePath);
  if (responseValuePaths.length > matchMax)
    return printLimit(responseValuePaths.length, find, matchMax, filePath);
  return print(
    generateResponseOverwriteCode(request, responseValuePaths, find, filePath)
  );
};

// TODO move into class
export const printResponseLogs = (
  settings: { responsesToLog?: RequestId[] },
  request: Request,
  response: ProxyResponse
) => {
  if (settings.responsesToLog?.includes(request.requestId))
    print(`${request.requestId}: ${JSON.stringify(response)}`);
};

// TODO Make sure only axios supported accept-encoding values are allowed by filtering list-strings like "gzip, deflate, br"
/** This insures there will be no type errors when using headers in axios. It also replaces accept-encoding to make sure axios can handle.*/
const convertHeaders = (
  headers: IncomingHttpHeaders,
  host: string,
  port: string
) => ({
  ...Object.keys(headers).reduce(
    (obj, key) => ({ ...obj, [key]: headers[key]?.toString() ?? "" }),
    {}
  ),
  // host and port need to be in the headers in order for the TLS handshake to work
  host,
  port,
  "accept-encoding": "gzip",
});

const getRequestBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      // We used to include this "fix" which broke things later.
      // body += chunk.toString().split("\\n").join("\r\n");
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

const convertToAxiosRequestConfig = async (
  request: Request,
  host: string,
  port: string
): Promise<AxiosRequestConfig> => ({
  headers: convertHeaders(request.headers, host, port),
  url: `${port === "443" ? "https" : "http"}://${host}${request.url}`,
  method: request.method,
  data: request.body,
  validateStatus: (status) =>
    (status >= 200 && status < 300) || (status >= 400 && status < 500),
});

/** @description Snapshots responses for request and provide them as stubs. */
// TODO write tests for class
export class HttpApiProxyServer {
  private overwrites: ProxyResponses;
  private settings: HttpApiProxyServerSettings;
  private initialOverwrites: ProxyResponses;
  private initialSettings: HttpApiProxyServerSettings;
  private cache: ResponseCacheConnector;
  private httpServer: HttpServer;
  private initialCachedRequestIds: Set<RequestId> = new Set();
  private usedRequestIds: Set<RequestId> = new Set();

  /**
   * @description
   * Hosting a local proxy server which replies to all known queries the same
   * way every time. It will fetch and remember replies from the real API in
   * case an unknown request is sent to it.
   *
   * @param overwrites
   * This allows the user to overwrite returns for specific queries.
   * set it to {find: 'some value you want to replace'} to get helpful autogenerated code.
   **/
  constructor({
    cacheDirPath,
    settings = {
      proxyBehavior: defaultProxyBehavior,
      sourceHost: "www.example.com",
      sourcePort: 443,
      proxyPort: 80,
    },
    overwrites = {},
  }: {
    cacheDirPath: string[];
    settings: HttpApiProxyServerSettings;
    overwrites?: ProxyResponses;
  }) {
    settings.proxyBehavior ||= defaultProxyBehavior;
    this.settings = clone(settings);
    this.overwrites = clone(overwrites);
    this.initialSettings = this.settings;
    this.initialOverwrites = this.overwrites;
    this.cache = new ResponseCacheConnector(cacheDirPath);

    this.httpServer = createServer(async (req, res) => {
      const url = req.url;
      const body =
        req.method === "POST" ? await getRequestBody(req) : undefined;
      const requestId = createRequestId({ url, body });

      const request: Request = {
        requestId,
        url,
        body,
        method: req.method,
        headers: req.headers,
      };

      this.resolveRequest(request).then((response) => {
        this.printReplacementCharAlert(JSON.stringify(response.body), request);
        this.printConsoleFeedback(request, response);
        this.replyToClient(res, response);
      });
    });
  }

  private printReplacementCharAlert = (
    stringValue: string,
    request: Request
  ) => {
    if (this.cache.getMetaInfo(request.requestId)["ignoreBrockenChars"]) return;
    const replacementChar = /\uFFFD/g;
    const brockenChars = JSON.stringify(stringValue).match(replacementChar);
    if (brockenChars?.length) {
      // TODO find a trigger for the line below
      //this.cache.saveMetaInfo(requestToId(req), { ignoreBrockenChars: true })
      print(
        `WARNING replacement-${brockenChars.length === 1 ? "char" : "chars"} ${
          brockenChars.length > 99
            ? `${brockenChars.join(", ").slice(0, 99)}...`
            : brockenChars.join(", ")
        } in ${this.cache.filePathForRequest(request)}`
      );
    }
  };

  private getLocalResponseIfExists = (requestId: RequestId) =>
    this.overwrites[requestId]
      ? { headers: fallbackHeaders, ...this.overwrites[requestId] }
      : this.cache.getResponse(requestId) || null;

  private resolveRequest = async (request: Request): Promise<ProxyResponse> => {
    const localResponse = this.getLocalResponseIfExists(request.requestId);

    switch (this.settings.proxyBehavior) {
      case "FORCE_UPDATE_ALL":
        return this.getApiResponseAndSaveToLocal(request);

      case "SAVE_RESPONSES_FOR_NEW_QUERIES":
        return localResponse || this.getApiResponseAndSaveToLocal(request);

      case "SAVE_RESPONSES_AND_DELETE_UNUSED":
        this.usedRequestIds.add(request.requestId);
        return localResponse || this.getApiResponseAndSaveToLocal(request);

      case "RELOAD_RESPONSES_WITH_ERRORS":
        return localResponse && !hasError(localResponse)
          ? localResponse
          : this.getApiResponseAndSaveToLocal(request);

      case "NO_REQUEST_FORWARDING":
        if (localResponse) return localResponse;
        else
          throw Error(
            `[HttpApiProxyServer proxyBehavior is set to ${
              this.settings.proxyBehavior
            }] Response not stored in the proxy cache! Request Details: ${JSON.stringify(
              request
            )}`
          );
    }
    if (localResponse === null)
      throw Error(`Faild to resolve request: ${JSON.stringify(request)}`);
    return localResponse;
  };

  private getApiResponseAndSaveToLocal = async (
    request: Request
  ): Promise<ProxyResponse> => {
    const apiResponse = await this.realApiResponse(request);
    this.cache.saveResponse(request, apiResponse);
    return apiResponse;
  };

  private realApiResponse = async (
    request: Request
  ): Promise<ProxyResponse> => {
    const host = this.settings.sourceHost;
    const port = this.settings.sourcePort.toString();
    try {
      const requestConfig = await convertToAxiosRequestConfig(
        request,
        host,
        port
      );
      const { status, headers, data } = await axios(requestConfig);
      return { status, headers, body: data };
    } catch (error) {
      const axiosError = error as AxiosError;
      print(`Error ${axiosError.code}: ${axiosError.message}`);
      const forwardedErrorStatusCode = axiosError.response?.status;
      const message =
        forwardedErrorStatusCode === undefined
          ? `[HttpApiProxyServer] Not able to extract Error code from response of ${host}`
          : `[HttpApiProxyServer] No successful response from ${host}`;
      return {
        status: forwardedErrorStatusCode ?? 500,
        headers: {},
        body: {
          errors: [{ message }, axiosError.toJSON() as { message: string }],
        },
      };
    }
  };

  /** Prints console outputs depending on its inputs. No output is also possible */
  private printConsoleFeedback = (
    request: Request,
    response: ProxyResponse
  ) => {
    const filePath = this.cache.filePathForRequest(request);
    printFindDeveloperHelp(request, response, filePath, this.settings?.find);
    printErrors(response, this.settings, filePath);
    printResponseLogs(this.settings, request, response);
  };

  // TODO Test using to have been called with (put handles in other function)
  private replyToClient = (
    res: Res,
    {
      status: apiResponseStatus,
      headers: apiResponseHeaders,
      body: apiResponseBody,
    }: ProxyResponse
  ) => {
    const bodyData = JSON.stringify(apiResponseBody);
    const bodyLength = Buffer.byteLength(bodyData);
    res.writeHead(apiResponseStatus, {
      ...apiResponseHeaders,
      "content-length": bodyLength.toString(), //since re-stringifying may slightly change length
      "access-control-allow-origin": "*", // to avoid issues due to the different host of the proxy-server
      // axios response headers are always lowercase, such that we can rely the overwrites will fit.
    });
    res.end(bodyData);
  };

  /** @description adding and overwrites by object key */
  modifyOverwrites = (overwrites: ProxyResponses) => {
    this.overwrites = { ...this.overwrites, ...clone(overwrites) };
  };

  /** @description adding and overwrite settings by object key */
  modifySettings = (settings: HttpApiProxyServerSettings) => {
    this.settings = { ...this.settings, ...clone(settings) };
  };

  /** @description reset to the overwrites used during construction */
  resetOverwrites = () => {
    this.overwrites = this.initialOverwrites;
  };

  /** @description reset to the settings used during construction */
  resetSettings = () => {
    this.settings = this.initialSettings;
  };

  start = async () =>
    new Promise((resolve, reject) => {
      if (this.settings.proxyBehavior === "SAVE_RESPONSES_AND_DELETE_UNUSED") {
        this.initialCachedRequestIds = new Set(
          this.cache.listResponseIds() as RequestId[]
        );
        this.usedRequestIds = new Set();
      }
      this.httpServer.listen(
        this.settings.proxyPort,
        undefined,
        undefined,
        () => resolve(undefined)
      );
      this.httpServer.on("error", (error) => {
        print(
          `HttpApiProxyServer failed to start on Port ${this.settings.proxyPort}`
        );
        reject(error);
      });
    });

  stop = async () =>
    new Promise((resolve, reject) => {
      this.httpServer.close((error) => {
        if (error) {
          print("HttpApiProxyServer failed to stop!");
          reject(error);
        } else {
          if (
            this.settings.proxyBehavior === "SAVE_RESPONSES_AND_DELETE_UNUSED"
          ) {
            this.initialCachedRequestIds.forEach((requestId) => {
              if (!this.usedRequestIds.has(requestId)) {
                this.cache.deleteResponse(requestId);
                print(`Deleted unused response:     ${requestId}`);
              }
            });
          }
          resolve(undefined);
        }
      });
    });
}
