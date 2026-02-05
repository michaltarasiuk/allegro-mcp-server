export function summarizeList<T>(
  items: T[],
  formatPreview: (item: T) => string,
  options: {
    title?: string;
    maxPreview?: number;
    detailsFormatter?: (item: T) => string;
    maxDetails?: number;
  } = {}
) {
  const {
    title = "List",
    maxPreview = 100,
    detailsFormatter,
    maxDetails = 5,
  } = options;
  if (items.length === 0) {
    return `## ${title} (0 items)\n\nNo items found.`;
  }
  const parts: string[] = [];
  const previewItems = items.slice(0, maxPreview);
  const hasMore = items.length > maxPreview;
  parts.push(`## ${title} (${items.length} items)`);
  parts.push("");
  parts.push(...previewItems.map(formatPreview));
  if (hasMore) {
    parts.push(`... and ${items.length - maxPreview} more`);
  }

  if (detailsFormatter && items.length > 0) {
    parts.push("");
    parts.push("## Details");
    parts.push("");
    const detailItems = items.slice(0, maxDetails);
    parts.push(...detailItems.map(detailsFormatter));
    if (items.length > maxDetails) {
      parts.push("");
      parts.push(
        `_Showing ${maxDetails} of ${items.length} items. Use pagination to see more._`
      );
    }
  }
  return parts.join("\n");
}

export function summarizeBatch<
  T extends {
    success: boolean;
  },
>(
  results: T[],
  options: {
    operationName: string;
    successFormatter: (result: T) => string;
    errorFormatter: (result: T) => string;
  }
) {
  const { operationName, successFormatter, errorFormatter } = options;
  const successes = results.filter((r) => r.success);
  const failures = results.filter((r) => !r.success);
  const parts: string[] = [];
  parts.push(`## ${operationName} Results`);
  parts.push("");
  parts.push(
    `**Summary**: ${successes.length} succeeded, ${failures.length} failed (${results.length} total)`
  );
  if (successes.length > 0) {
    parts.push("");
    parts.push("### Successful Operations");
    parts.push("");
    parts.push(...successes.map(successFormatter));
  }

  if (failures.length > 0) {
    parts.push("");
    parts.push("### Failed Operations");
    parts.push("");
    parts.push(...failures.map(errorFormatter));
  }
  return parts.join("\n");
}

export function formatFieldChange(
  fieldName: string,
  before: string | number | boolean | null | undefined,
  after: string | number | boolean | null | undefined
) {
  const formatValue = (value: string | number | boolean | null | undefined) => {
    if (value === null || value === undefined) {
      return "—";
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    return String(value);
  };
  return `${fieldName}: ${formatValue(before)} → ${formatValue(after)}`;
}

export function createSection(
  content: string,
  options: {
    tag?: string;
    indent?: number;
  } = {}
) {
  const { tag, indent = 0 } = options;
  const indentation = " ".repeat(indent);
  if (!tag) {
    return content
      .split("\n")
      .map((line) => indentation + line)
      .join("\n");
  }
  const lines: string[] = [];
  lines.push(`${indentation}<ove tag="${tag}">`);
  lines.push(
    ...content
      .split("\n")
      .map((line) => indentation + (line ? `  ${line}` : line))
  );
  lines.push(`${indentation}</ove>`);
  return lines.join("\n");
}

export function truncate(text: string, maxLength = 100) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

export function formatKeyValueList(
  pairs: Record<string, string | number | boolean | null | undefined>
) {
  return Object.entries(pairs)
    .filter(([_key, value]) => value !== null && value !== undefined)
    .map(([key, value]) => {
      const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
      return `- **${capitalizedKey}**: ${value}`;
    })
    .join("\n");
}
