/**
 * Simple glob matching without external dependencies.
 * Supports: *, **, ?, {a,b}
 */
export function minimatch(path: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(path);
}

function globToRegex(pattern: string): RegExp {
  let regex = "^";
  let i = 0;

  while (i < pattern.length) {
    const c = pattern[i];

    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // ** matches any path segment
        if (pattern[i + 2] === "/") {
          regex += "(?:.+/)?";
          i += 3;
        } else {
          regex += ".*";
          i += 2;
        }
      } else {
        // * matches within a segment
        regex += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      regex += "[^/]";
      i++;
    } else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end !== -1) {
        const alternatives = pattern.slice(i + 1, end).split(",");
        regex += `(?:${alternatives.map(escapeRegex).join("|")})`;
        i = end + 1;
      } else {
        regex += escapeRegex(c);
        i++;
      }
    } else if (c === "[") {
      const end = pattern.indexOf("]", i);
      if (end !== -1) {
        regex += pattern.slice(i, end + 1);
        i = end + 1;
      } else {
        regex += escapeRegex(c);
        i++;
      }
    } else {
      regex += escapeRegex(c);
      i++;
    }
  }

  regex += "$";
  return new RegExp(regex);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
