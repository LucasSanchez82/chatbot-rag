/**
 * Simple async stdin question helper without readline dependency reuse.
 * Keeps a single listener and resolves once user inputs a line.
 */
export async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    const onData = (data: Buffer) => {
      const input = data.toString().trim();
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      resolve(input);
    };
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
  });
}

/**
 * Ask with default fallback.
 */
export async function askWithDefault(
  prompt: string,
  defaultValue: string
): Promise<string> {
  const answer = await ask(
    `${prompt}${defaultValue ? ` (default: ${defaultValue})` : ""} > `
  );
  return answer || defaultValue;
}
