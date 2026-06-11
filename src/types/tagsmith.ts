export type BumpLevel = "major" | "minor" | "patch" | "prerelease" | "auto";

export type ConfigSource = "file" | "inferred" | "default";

export interface TagPlan {
  tag: string;
  version: string;
  fromVersion: string | null;
  fresh: boolean;
  line: string;
  configSource: ConfigSource;
  latestTag: string | null;
  anomalyCount: number;
}

export interface CreateTagRequest {
  repositoryPath: string;
  tagName: string;
  message?: string;
  push: boolean;
  remote?: string;
}

export interface CreateTagResponse {
  preview: import("./git").GitCommandPreview;
  pushPreview: import("./git").GitCommandPreview | null;
  stdout: string;
  stderr: string;
}

export interface TagsmithConfigResponse {
  exists: boolean;
  content: string | null;
}

export interface DeleteTagRequest {
  repositoryPath: string;
  tagName: string;
  remote?: string;
}

export interface DeleteTagResponse {
  preview: import("./git").GitCommandPreview;
  remotePreview: import("./git").GitCommandPreview | null;
  stdout: string;
  stderr: string;
}
