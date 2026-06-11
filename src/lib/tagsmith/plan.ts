import { buildImplicitConfig, parseConfig } from "@carllee1983/tagsmith/dist/core/config.js";
import { analyzeTags } from "@carllee1983/tagsmith/dist/core/analyze.js";
import { assignTagsToLines, selectLine } from "@carllee1983/tagsmith/dist/core/lines.js";
import { createModel } from "@carllee1983/tagsmith/dist/core/models/index.js";
import { compilePattern } from "@carllee1983/tagsmith/dist/core/pattern.js";
import { planNext, validateExplicit } from "@carllee1983/tagsmith/dist/core/plan.js";
import type { BumpLevel, ConfigSource, TagPlan, TagsmithConfigResponse } from "../../types/tagsmith";

function resolveConfig(config: TagsmithConfigResponse, tags: readonly string[]) {
  if (config.exists && config.content) {
    const json = JSON.parse(config.content) as unknown;
    return { config: parseConfig(json), source: "file" as const };
  }
  return buildImplicitConfig(tags);
}

export function planNextTag(input: {
  config: TagsmithConfigResponse;
  tags: readonly string[];
  level?: BumpLevel;
  lineName?: string;
  explicitVersion?: string;
  allowOutOfOrder?: boolean;
}): TagPlan {
  const level = input.level ?? "patch";
  const resolved = resolveConfig(input.config, input.tags);
  const line = selectLine(resolved.config, input.lineName);
  const model = createModel(line.model);
  const lineTags = assignTagsToLines(input.tags, resolved.config.lines).byLine.get(line.name) ?? [];
  const explicitVersion = input.explicitVersion?.trim();

  if (explicitVersion) {
    const result = validateExplicit(line, model, explicitVersion, lineTags, {
      allowOutOfOrder: input.allowOutOfOrder,
    });
    if (!result.ok) {
      throw new Error(result.errors.join(" "));
    }
    const parsed = model.parse(explicitVersion);
    if (parsed === null) {
      throw new Error(`Version "${explicitVersion}" is not valid for the ${model.type} model.`);
    }
    const pattern = compilePattern(line.pattern);
    const analysis = analyzeTags(lineTags, pattern, model);
    const version = model.format(parsed);

    return {
      tag: pattern.render(version),
      version,
      fromVersion: analysis.latest ? model.format(analysis.latest.version) : null,
      fresh: analysis.latest === null,
      line: line.name,
      configSource: resolved.source as ConfigSource,
      latestTag: analysis.latest?.raw ?? null,
      anomalyCount: analysis.anomalies.length,
    };
  }

  const plan = planNext(line, model, lineTags, level);
  const latestTag = plan.analysis.latest?.raw ?? null;

  return {
    tag: plan.tag,
    version: plan.version,
    fromVersion: plan.fromVersion,
    fresh: plan.fresh,
    line: line.name,
    configSource: resolved.source as ConfigSource,
    latestTag,
    anomalyCount: plan.analysis.anomalies.length,
  };
}

export function listTagLines(config: TagsmithConfigResponse, tags: readonly string[]) {
  const resolved = resolveConfig(config, tags);
  return resolved.config.lines.map((line) => ({
    name: line.name,
    pattern: line.pattern,
    push: line.push,
    isDefault: line.name === resolved.config.default,
  }));
}
