import * as fs from "fs";
import { print } from "./print";
import path from "path";

// Note: in jest one can test class function using jest.spyOn

// TODO import types
type ResponseData = Record<string, unknown> & {
  errors?: { message: string }[];
};
type RequestId = `responseFor${string}`;
type Request = {
  requestId: RequestId;
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: string | undefined;
};
type ProxyResponse = {
  body: ResponseData;
  status: number;
};

export class ResponseCacheConnector {
  private cacheDirPath: string[];

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

  getResponse = (requestId: string) => {
    const filePath = this.filePathForRequestId(requestId);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  };

  saveResponse = (request: Request, response: ProxyResponse) => {
    if (!request.url) {
      throw new Error(
        "[saveResponse] Cannot handle a request with missing URL"
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
