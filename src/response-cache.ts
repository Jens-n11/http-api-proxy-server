import * as fs from "fs";
import { print } from "./print";
import path from "path";
import { fallbackHeaders, ProxyResponse, Request } from "./proxy-server";

// Note: in jest one can test class function using jest.spyOn

export class ResponseCacheConnector {
  private cacheDirPath: string[];
  private responseFilePrefix = "responseFor";

  constructor(cacheDirPath: string[] = ["responses"]) {
    this.cacheDirPath = cacheDirPath;
  }

  private requireDir() {
    let currentDir = ".";
    this.cacheDirPath.forEach((part) => {
      currentDir = path.join(currentDir, part);
      if (!fs.existsSync(currentDir)) fs.mkdirSync(currentDir);
    });
    return currentDir;
  }

  getResponse = (requestId: string): ProxyResponse | null => {
    const filePath = this.filePathForRequestId(requestId);
    if (!fs.existsSync(filePath)) return null;
    const fileContentAsJson = JSON.parse(
      fs.readFileSync(filePath, "utf8")
    ) as ProxyResponse;
    return {
      status: fileContentAsJson.status,
      headers: fileContentAsJson.headers || fallbackHeaders,
      body: fileContentAsJson.body,
    };
  };

  listResponseIds = (): string[] => {
    const responseDir = this.requireDir();
    return fs
      .readdirSync(responseDir)
      .filter(
        (fileName) =>
          fileName.startsWith(this.responseFilePrefix) &&
          fileName.endsWith(".json") &&
          !fileName.endsWith(".meta.json")
      )
      .map((fileName) => fileName.replace(".json", ""));
  };

  deleteResponse = (requestId: string) => {
    const responseFilePath = this.filePathForRequestId(requestId);
    const metaInfoFilePath = this.metaInfoFilePathForRequestId(requestId);
    if (fs.existsSync(responseFilePath)) fs.unlinkSync(responseFilePath);
    if (fs.existsSync(metaInfoFilePath)) fs.unlinkSync(metaInfoFilePath);
  };

  pruneApiQueryLog = (deletedRequestIds: string[]) => {
    if (deletedRequestIds.length === 0) return;
    const responseDir = this.requireDir();
    const logPath = path.join(responseDir, "apiQuery.log");
    if (!fs.existsSync(logPath)) return;

    const deletedFilePaths = new Set(
      deletedRequestIds.map((requestId) => this.filePathForRequestId(requestId))
    );
    const logContent = fs.readFileSync(logPath, "utf8");
    const entries = logContent
      .split(/\n\n+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const filteredEntries = entries.filter((entry) => {
      const firstLine = entry.split("\n")[0] ?? "";
      return !deletedFilePaths.has(firstLine.split(",")[0] ?? "");
    });
    const nextContent = filteredEntries.join("\n\n");
    fs.writeFileSync(logPath, nextContent ? `${nextContent}\n\n` : "");
  };

  saveResponse = (request: Request, response: ProxyResponse) => {
    if (!request.url) {
      throw new Error(
        `[saveResponse] Cannot handle a request with missing URL: ${JSON.stringify(
          request
        )}`
      );
    }

    const responseDir = this.requireDir();
    const fileName = this.filePathForRequest(request);
    const logLine = `${fileName}, ${decodeURIComponent(request.url)}`;
    try {
      fs.appendFileSync(
        // TODO create log name config
        path.join(responseDir, "apiQuery.log"),
        logLine + "\n\n"
      );
    } catch {
      print(`FAILED to append log info for:  ${fileName}`);
    }
    try {
      fs.writeFileSync(fileName, JSON.stringify(response));
      print(`Saved query response to:        ${fileName}`);
    } catch {
      print(`FAILED to save response:        ${fileName}`);
    }
  };

  getMetaInfo = (requestId: string) => {
    const filePath = this.metaInfoFilePathForRequestId(requestId);
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  };

  // TODO Implement a way to trigger this
  saveMetaInfo = (requestId: string, metaInfo: Record<string, boolean>) => {
    const fileName = this.metaInfoFilePathForRequestId(requestId);
    try {
      fs.writeFileSync(fileName, JSON.stringify(metaInfo));
      print(`Saved metaInfo for response to: ${fileName}`);
    } catch {
      print(`FAILED to save response:        ${fileName}`);
    }
  };

  filePathForRequestId = (RequestId: string) =>
    path.join(path.join(...this.cacheDirPath), `${RequestId}.json`);

  private metaInfoFilePathForRequestId = (RequestId: string) =>
    path.join(path.join(...this.cacheDirPath), `${RequestId}.meta.json`);

  filePathForRequest = (request: Request) =>
    this.filePathForRequestId(request.requestId);
}
