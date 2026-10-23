/**
 * Minimal INI helpers for Assetto server_cfg.ini (section-aware patches).
 */

/** Set FIELD=value: keep one line (first slot), drop later duplicates; append if missing. */
export function patchIniField(content: string, field: string, value: string): string {
  const line = `${field}=${value}`;
  const fieldRe = new RegExp(`^${field}=`);
  const lines = content.split('\n');
  let replaced = false;
  const out: string[] = [];
  for (const row of lines) {
    if (fieldRe.test(row)) {
      if (!replaced) {
        out.push(line);
        replaced = true;
      }
      // drop duplicate FIELD= lines
      continue;
    }
    out.push(row);
  }
  if (!replaced) {
    const trimmed = out.join('\n').trimEnd();
    return `${trimmed}\n${line}\n`;
  }
  return out.join('\n');
}

export function extractIniSection(content: string, section: string): string {
  // No `m` flag: with multiline, `$` matches end-of-line and truncates the body
  // to the first key, causing patchIniSectionField to append duplicates.
  const re = new RegExp(`\\[${section}\\]\\s*([\\s\\S]*?)(?=\\n\\[|$)`);
  const match = re.exec(content);
  return match?.[1] ?? '';
}

export function readIniField(content: string, field: string): string | null {
  const match = new RegExp(`^${field}=(.*)$`, 'm').exec(content);
  return match ? match[1].trim() : null;
}

export function readIniSectionField(
  content: string,
  section: string,
  field: string,
): string | null {
  const block = extractIniSection(content, section);
  if (!block) {
    return null;
  }
  return readIniField(block, field);
}

/**
 * Within a section body, keep the last occurrence of each KEY= (AC typically reads last)
 * and drop earlier duplicates. Blank lines and non-key lines are preserved in order.
 */
export function collapseDuplicateIniFields(body: string): string {
  const lines = body.split('\n');
  const lastIndexByKey = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const m = /^([^=]+)=(.*)$/.exec(lines[i] ?? '');
    if (!m) continue;
    lastIndexByKey.set(m[1], i);
  }
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i] ?? '';
    const m = /^([^=]+)=(.*)$/.exec(row);
    if (!m) {
      out.push(row);
      continue;
    }
    if (lastIndexByKey.get(m[1]) === i) {
      out.push(row);
    }
  }
  return out.join('\n');
}

/** Collapse duplicate keys inside [section] (keep last). No-op if section missing. */
export function collapseDuplicateIniSectionFields(content: string, section: string): string {
  if (!extractIniSection(content, section) && !new RegExp(`\\[${section}\\]`).test(content)) {
    return content;
  }
  const re = new RegExp(`(\\[${section}\\]\\s*)([\\s\\S]*?)(?=\\n\\[|$)`);
  return content.replace(re, (_full, header: string, body: string) => {
    return `${header}${collapseDuplicateIniFields(body)}`;
  });
}

/** Patch field inside [section]; creates the section if missing. */
export function patchIniSectionField(
  content: string,
  section: string,
  field: string,
  value: string,
): string {
  if (!extractIniSection(content, section)) {
    return `${content.trimEnd()}\n[${section}]\n${field}=${value}\n`;
  }
  const re = new RegExp(`(\\[${section}\\]\\s*)([\\s\\S]*?)(?=\\n\\[|$)`);
  return content.replace(re, (_full, header: string, body: string) => {
    const patchedBody = patchIniField(body, field, value);
    return `${header}${patchedBody}`;
  });
}
