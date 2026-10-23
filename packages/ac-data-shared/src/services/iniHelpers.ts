/**
 * Minimal INI helpers for Assetto server_cfg.ini (section-aware patches).
 */

export function patchIniField(content: string, field: string, value: string): string {
  const line = `${field}=${value}`;
  if (new RegExp(`^${field}=`, 'm').test(content)) {
    return content.replace(new RegExp(`^${field}=.*$`, 'm'), line);
  }
  return `${content.trimEnd()}\n${line}\n`;
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
