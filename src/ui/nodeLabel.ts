const NAME_LINE_CHARS = 17;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Splits a name over at most two lines at a word boundary so it fits in a tree node. */
export function nameLines(name: string, max = NAME_LINE_CHARS): string[] {
  if (name.length <= max) return [name];
  const words = name.split(/\s+/);
  let first = '';
  while (words.length && (first ? `${first} ${words[0]}` : words[0]!).length <= max) {
    first = first ? `${first} ${words.shift()}` : words.shift()!;
  }
  if (!first) return [truncate(name, max)];
  return [first, truncate(words.join(' '), max)];
}
