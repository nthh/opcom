/**
 * Replace {{variable}} placeholders in text with values from the given map.
 * Unmatched placeholders are left as-is.
 */
export function substituteVariables(
  text: string,
  variables: Record<string, string>,
): string {
  return text.replace(/\{\{(\w+(?:-\w+)*)\}\}/g, (match, name: string) => {
    return variables[name] ?? match;
  });
}
